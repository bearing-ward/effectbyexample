/**
 * @title Signing a session challenge
 * @difficulty advanced
 * @summary `EventLogSessionAuth` holds the steps a device and a sync server
 * use to prove who is connecting: make a challenge, sign it, verify the
 * signature. `EventLogRemote` runs them for you; doing them by hand shows
 * what each step checks and why a reused or altered signature fails.
 */

import { Console, Effect } from 'effect'
import {
  EventJournal,
  EventLog,
  EventLogEncryption,
  EventLogSessionAuth,
} from 'effect/eventlog'

// `EventLogSessionAuth` is marked unstable. Signatures use Ed25519 through
// Web Crypto. A real device derives its signing key pair from its
// identity's private key inside `EventLogRemote`. That derivation is not
// exported, so this program makes an ordinary Ed25519 key pair to play the
// device's part. Signing keys travel as raw public bytes and PKCS#8 private
// bytes.
const makeSigningKeys = Effect.promise(async () => {
  const pair = await crypto.subtle.generateKey('Ed25519', true, [
    'sign',
    'verify',
  ])
  /* The types allow a single key; Ed25519 always makes a pair. */
  if (!('privateKey' in pair)) throw new Error('expected a key pair')
  return {
    publicKey: new Uint8Array(
      await crypto.subtle.exportKey('raw', pair.publicKey),
    ),
    privateKey: new Uint8Array(
      await crypto.subtle.exportKey('pkcs8', pair.privateKey),
    ),
  }
})

export const program = Effect.gen(function* () {
  const identity = yield* EventLog.makeIdentity
  const device = yield* makeSigningKeys

  // Server: a fresh random challenge for this connection, plus the
  // server's own id. Both go into what the device signs.
  const remoteId = EventJournal.makeRemoteIdUnsafe()
  const challenge = yield* EventLogSessionAuth.makeSessionAuthChallenge
  yield* Console.log('challenge bytes:', challenge.length)

  // Device: sign the challenge. `signSessionAuthPayload` encodes the fields
  // in a fixed byte layout and signs that.
  const fields = {
    remoteId,
    challenge,
    publicKey: identity.publicKey,
    signingPublicKey: device.publicKey,
  }
  const signature = yield* EventLogSessionAuth.signSessionAuthPayload({
    ...fields,
    signingPrivateKey: device.privateKey,
  })
  yield* Console.log('signature bytes:', signature.length)

  // Server: check the request. `verifySessionAuthenticateRequest` also
  // insists the device named the Ed25519 algorithm.
  const request = { ...fields, signature, algorithm: 'Ed25519' }
  yield* Console.log(
    'valid request:',
    yield* EventLogSessionAuth.verifySessionAuthenticateRequest(request),
  )

  // The `Bytes` variants work on an already encoded payload, for example
  // when one process builds it and another holds the key.
  const payload = yield* EventLogSessionAuth.encodeSessionAuthPayload(fields)
  const fromBytes = yield* EventLogSessionAuth.signSessionAuthPayloadBytes({
    payload,
    signingPrivateKey: device.privateKey,
  })
  yield* Console.log(
    'bytes round trip:',
    yield* EventLogSessionAuth.verifySessionAuthPayloadBytes({
      payload,
      signingPublicKey: device.publicKey,
      signature: fromBytes,
    }),
  )

  // A bad signature is not an error, it verifies as `false`. Here: one
  // flipped bit, the same signature checked against a newer challenge, and
  // the right signature checked with another device's public key.
  const flipped = signature.slice()
  flipped[0] = flipped[0]! ^ 0x01
  const newChallenge = yield* EventLogSessionAuth.makeSessionAuthChallenge
  const otherDevice = yield* makeSigningKeys
  const checks = [
    { ...fields, signature: flipped },
    { ...fields, challenge: newChallenge, signature },
    { ...fields, signingPublicKey: otherDevice.publicKey, signature },
  ]
  for (const check of checks) {
    yield* Console.log(
      'still valid:',
      yield* EventLogSessionAuth.verifySessionAuthPayload(check),
    )
  }

  // Malformed requests fail with `EventLogSessionAuthError`, whose `reason`
  // says which check failed.
  const error = yield* EventLogSessionAuth.verifySessionAuthenticateRequest({
    ...request,
    algorithm: 'RSA',
  }).pipe(Effect.flip)
  yield* Console.log(
    error instanceof EventLogSessionAuth.EventLogSessionAuthError,
    error.reason,
  )
}).pipe(Effect.provide(EventLogEncryption.layerSubtle))
