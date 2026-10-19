/**
 * @title Challenges expire
 * @difficulty advanced
 * @summary A sync server's challenge is good for one sign-in, and only for
 * `SessionAuthChallengeTimeToLiveMillis`. A device that waits too long, or
 * sends the same signature twice, has to ask for a new challenge.
 */

import { Console, Effect, Layer, Stream } from 'effect'
import {
  EventJournal,
  EventLog,
  EventLogEncryption,
  EventLogMessage,
  EventLogServer,
  EventLogSessionAuth,
} from 'effect/eventlog'
import { RpcTest } from 'effect/rpc'
import { TestClock } from 'effect/testing'

// As in "Signing a session challenge", an Ed25519 key pair stands in for
// the signing keys that `EventLogRemote` derives from an identity.
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

// A server built on `EventLogServer.layerRpcHandlers`. It keeps each
// challenge in a cache whose entries live for the time-to-live, measured
// with Effect's `Clock`. Under `TestClock` we move time by hand. This server
// knows one enrolled device key and stores nothing.
const makeServer = (enrolledKey: Uint8Array<ArrayBuffer>) =>
  EventLogServer.layerRpcHandlers({
    remoteId: EventJournal.makeRemoteIdUnsafe(),
    getOrCreateSessionAuthBinding: () => Effect.succeed(enrolledKey),
    onWrite: () => Effect.void,
    changes: () => Stream.never,
  })

const signInLater = (device: Effect.Success<typeof makeSigningKeys>) =>
  Effect.gen(function* () {
    yield* Console.log(
      'challenge lifetime:',
      EventLogSessionAuth.SessionAuthChallengeTimeToLiveMillis,
      'ms',
    )
    const identity = yield* EventLog.makeIdentity
    const client = yield* RpcTest.makeClient(EventLogMessage.EventLogRemoteRpcs)

    // Ask for a challenge and sign it, as a device does when it connects.
    const signIn = Effect.gen(function* () {
      const hello = yield* client['EventLog.Hello']()
      const signature = yield* EventLogSessionAuth.signSessionAuthPayload({
        remoteId: hello.remoteId,
        challenge: hello.challenge,
        publicKey: identity.publicKey,
        signingPublicKey: device.publicKey,
        signingPrivateKey: device.privateKey,
      })
      return {
        publicKey: identity.publicKey,
        signingPublicKey: device.publicKey,
        signature,
        algorithm: 'Ed25519' as const,
      }
    })
    const send = (request: Effect.Success<typeof signIn>) =>
      client['EventLog.Authenticate'](request).pipe(
        Effect.as('accepted'),
        Effect.catch((error) => Effect.succeed(error.message)),
      )

    // Answered one second before the deadline: accepted.
    const prompt = yield* signIn
    yield* TestClock.adjust(
      EventLogSessionAuth.SessionAuthChallengeTimeToLiveMillis - 1000,
    )
    yield* Console.log('in time:', yield* send(prompt))

    // The server dropped that challenge once it was used, so the same
    // signature cannot open a second session.
    yield* Console.log('replayed:', yield* send(prompt))

    // A new challenge, answered after the deadline: refused.
    const late = yield* signIn
    yield* TestClock.adjust(
      EventLogSessionAuth.SessionAuthChallengeTimeToLiveMillis,
    )
    yield* Console.log('too late:', yield* send(late))
  }).pipe(Effect.provide(makeServer(device.publicKey)), Effect.scoped)

export const program = Effect.gen(function* () {
  yield* signInLater(yield* makeSigningKeys)
}).pipe(Effect.provide([EventLogEncryption.layerSubtle, TestClock.layer()]))
