/**
 * @title Session authentication
 * @difficulty advanced
 * @summary Before a sync server accepts writes, a device proves who it is:
 * the server sends a random challenge and the device signs it with a key
 * derived from its identity. `EventLogServer` runs this exchange for every
 * connection, and `EventLogSessionAuth` defines what gets signed.
 */

import { Console, Effect, Layer, Queue, Schema, Stream } from 'effect'
import {
  EventGroup,
  EventJournal,
  EventLog,
  EventLogEncryption,
  EventLogMessage,
  EventLogRemote,
  EventLogServer,
  EventLogSessionAuth,
} from 'effect/eventlog'
import { RpcTest } from 'effect/rpc'

const NoteEvents = EventGroup.empty.add({
  tag: 'NoteWritten',
  primaryKey: (note) => note.id,
  payload: Schema.Struct({ id: Schema.String, text: Schema.String }),
})
const NoteLog = EventLog.schema(NoteEvents)

// A custom server built on `EventLogServer.layerRpcHandlers`, the same
// function both built-in servers use. It answers the challenge and checks
// signatures itself; `onWrite` only runs for authenticated connections.
// This server stores nothing. It reports each write on a queue.
const makeServer = (received: Queue.Queue<string>) => {
  const signingKeys = new Map<string, Uint8Array<ArrayBuffer>>()
  return EventLogServer.layerRpcHandlers({
    remoteId: EventJournal.makeRemoteIdUnsafe(),
    // `getOrCreateSessionAuthBinding` returns the signing key the server
    // expects for an identity. This server keeps them in a map.
    getOrCreateSessionAuthBinding: (publicKey, signingPublicKey) =>
      Effect.sync(() => {
        const known = signingKeys.get(publicKey) ?? signingPublicKey
        signingKeys.set(publicKey, known)
        return known
      }),
    onWrite: (data, authenticated) =>
      EventLogMessage.WriteEntries.decode(data).pipe(
        Effect.flatMap((write) =>
          Queue.offer(
            received,
            `${write.encryptedEntries.length} entry for store ${write.storeId}, ` +
              `authenticated: ${authenticated.has(write.publicKey)}`,
          ),
        ),
        Effect.asVoid,
        Effect.orDie,
      ),
    changes: () => Stream.never,
  })
}

const checkSessions = (received: Queue.Queue<string>) =>
  Effect.gen(function* () {
    // Talk to the server by hand first, with a raw RPC client.
    const raw = yield* RpcTest.makeClient(EventLogMessage.EventLogRemoteRpcs)

    // Without a session, writes are refused.
    const anonymous = yield* raw['EventLog.WriteSingle']({
      data: new Uint8Array([1, 2, 3]),
    }).pipe(Effect.flip)
    yield* Console.log(anonymous.code, anonymous.message)

    // `Hello` returns the server's id and a fresh random challenge.
    const hello = yield* raw['EventLog.Hello']()
    yield* Console.log(
      hello.challenge.length === EventLogSessionAuth.SessionAuthChallengeLength,
    )

    // This is what a device signs: a fixed context string, the server's id,
    // the challenge, the identity's public key, and the signing public key.
    // Binding the server id and challenge means a signature cannot be replayed
    // against another server or a later session.
    const identity = yield* EventLog.makeIdentity
    const attempt = {
      remoteId: hello.remoteId,
      challenge: hello.challenge,
      publicKey: identity.publicKey,
      signingPublicKey: new Uint8Array(
        EventLogSessionAuth.Ed25519PublicKeyLength,
      ).fill(0x11),
    }
    const payload = yield* EventLogSessionAuth.encodeSessionAuthPayload(attempt)
    const decoded = yield* EventLogSessionAuth.decodeSessionAuthPayload(payload)
    yield* Console.log(decoded.publicKey === identity.publicKey)
    yield* Console.log(EventLogSessionAuth.AuthPayloadContext)

    // A made-up signature fails verification.
    const rejected = yield* raw['EventLog.Authenticate']({
      publicKey: identity.publicKey,
      signingPublicKey: attempt.signingPublicKey,
      signature: new Uint8Array(
        EventLogSessionAuth.Ed25519SignatureLength,
      ).fill(0x22),
      algorithm: 'Ed25519',
    }).pipe(Effect.flip)
    yield* Console.log(rejected.code, rejected.message)

    // A real device does the whole exchange when it connects: hello, sign the
    // challenge with its derived signing key, authenticate. After that its
    // writes reach `onWrite`. The device creates its own identity.
    const device = EventLog.layer(
      NoteLog,
      EventLog.group(NoteEvents, (handlers) =>
        handlers.handle('NoteWritten', () => Effect.void),
      ),
    ).pipe(
      Layer.provideMerge(
        Layer.effectDiscard(
          Effect.gen(function* () {
            const client = yield* RpcTest.makeClient(
              EventLogMessage.EventLogRemoteRpcs,
            )
            yield* EventLogRemote.makeEncrypted.pipe(
              Effect.provideService(
                EventLogRemote.EventLogRemoteClient,
                client,
              ),
            )
          }),
        ),
      ),
      Layer.provide(EventLog.layerRegistry),
      Layer.provide(EventJournal.layerMemory),
      Layer.provide(Layer.effect(EventLog.Identity, EventLog.makeIdentity)),
    )
    yield* Effect.gen(function* () {
      const write = yield* EventLog.makeClient(NoteLog)
      yield* write('NoteWritten', { id: 'note-1', text: 'hello' })
      // Wait for the server's `onWrite` to report it.
      yield* Console.log(yield* Queue.take(received))
    }).pipe(Effect.provide(device))
  })

export const program = Effect.gen(function* () {
  const received = yield* Queue.unbounded<string>()
  yield* checkSessions(received).pipe(Effect.provide(makeServer(received)))
}).pipe(Effect.scoped, Effect.provide(EventLogEncryption.layerSubtle))
