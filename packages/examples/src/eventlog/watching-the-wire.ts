/**
 * @title Watching the protocol
 * @difficulty advanced
 * @summary A small in-memory transport that logs every request a remote sends
 * and every reply it gets back. It shows the session handshake, a single
 * write, and a large write split into chunks, as they really happen.
 */

// The event log modules and the RPC modules used here are marked unstable.
import { Console, Effect, Exit, Layer, Queue } from 'effect'
import {
  EventJournal,
  EventLog,
  EventLogEncryption,
  EventLogMessage,
  EventLogRemote,
  EventLogServerEncrypted,
} from 'effect/eventlog'
import { RpcClient, RpcServer } from 'effect/rpc'
import type { RpcGroup } from 'effect/rpc'

type Rpcs = RpcGroup.Rpcs<typeof EventLogMessage.EventLogRemoteRpcs>

// Name a message by its class. The handshake messages and the frames are
// classes from `EventLogMessage`, so `instanceof` tells them apart. The other
// payloads are plain objects and print as just the RPC's tag.
const describe = (value: unknown): string => {
  if (value instanceof EventLogMessage.HelloResponse) {
    return `HelloResponse, challenge of ${value.challenge.length} bytes`
  }
  if (value instanceof EventLogMessage.Authenticate) {
    return `Authenticate, ${value.algorithm} signature`
  }
  if (value instanceof EventLogMessage.ChunkedMessage) {
    return `ChunkedMessage, part ${value.part[0] + 1} of ${value.part[1]}`
  }
  if (value instanceof EventLogMessage.SingleMessage) return 'SingleMessage'
  return ''
}

// A transport moves messages between an RPC client and an RPC server. This
// one hands them over in memory, like `RpcTest`, but logs each one first.
// A WebSocket or `postMessage` transport does the same with encoding.
const connect = Effect.gen(function* () {
  let client!: Effect.Success<
    ReturnType<typeof RpcClient.makeNoSerialization<Rpcs, never>>
  >
  const server = yield* RpcServer.makeNoSerialization(
    EventLogMessage.EventLogRemoteRpcs,
    {
      onFromServer: (response) =>
        Effect.gen(function* () {
          if (response._tag === 'Exit' && Exit.isSuccess(response.exit)) {
            const value: unknown = response.exit.value
            if (describe(value)) yield* Console.log('  <-', describe(value))
          }
          if (response._tag === 'Chunk') {
            for (const value of response.values) {
              yield* Console.log('  <-', describe(value))
            }
          }
          yield* client.write(response)
        }),
    },
  )
  const connection = yield* RpcClient.makeNoSerialization(
    EventLogMessage.EventLogRemoteRpcs,
    {
      supportsAck: true,
      onFromClient: ({ message }) =>
        Effect.gen(function* () {
          if (message._tag === 'Request') {
            const payload: unknown = message.payload
            yield* Console.log(`-> ${message.tag} ${describe(payload)}`.trim())
          }
          yield* server.write(0, message)
        }),
    },
  )
  client = connection
  return connection.client
})

export const program = Effect.gen(function* () {
  const identity = yield* EventLog.makeIdentity
  const storeId = EventLogMessage.StoreId.make('default')
  const entry = (payload: Uint8Array) =>
    new EventJournal.Entry({
      id: EventJournal.makeEntryIdUnsafe(),
      event: 'PhotoAdded',
      primaryKey: 'photo-1',
      payload,
    })

  // In an app, `EventLog` drives the remote. Here we call the remote's
  // `write` and `changes` ourselves, so each step is visible. Creating the
  // remote sends `Hello`. The server answers with its id and a random
  // challenge for this connection.
  const client = yield* connect
  const remote = yield* EventLogRemote.makeEncrypted.pipe(
    Effect.provideService(EventLogRemote.EventLogRemoteClient, client),
  )

  // The first write for an identity authenticates it: the remote signs the
  // challenge with a key derived from the identity and sends `Authenticate`.
  // Then the entry goes out in one `WriteSingle`.
  yield* Console.log('small write')
  yield* remote.write({
    identity,
    storeId,
    entries: [entry(new Uint8Array(10))],
  })

  // The session is cached, so a second write skips the handshake. This entry
  // is larger than `ChunkedMessage.chunkSize`, so it travels in parts.
  yield* Console.log('large write')
  yield* remote.write({
    identity,
    storeId,
    entries: [entry(new Uint8Array(1_100_000))],
  })

  // Reading opens one `Changes` stream. The server sends the stored entries
  // as one batch. With the photo in it the batch is over the chunk size, so
  // it comes back in parts as well. The remote joins and decrypts them and
  // hands back journal entries numbered by the server, starting at 0.
  yield* Console.log('read changes')
  const changes = yield* remote.changes({ identity, storeId, startSequence: 0 })
  const received = yield* Queue.takeN(changes, 2)
  yield* Console.log(
    received.map(
      (r) => `#${r.remoteSequence}: ${r.entry.payload.length} bytes`,
    ),
  )
}).pipe(
  Effect.scoped,
  Effect.provide(
    Layer.mergeAll(
      EventLogServerEncrypted.layerRpcHandlers.pipe(
        Layer.provide(EventLogServerEncrypted.layerStorageMemory),
      ),
      EventLog.layerRegistry,
      EventLogEncryption.layerSubtle,
    ),
  ),
)
