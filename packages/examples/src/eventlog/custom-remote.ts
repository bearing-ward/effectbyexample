/**
 * @title A remote with its own wire format
 * @difficulty advanced
 * @summary `EventLogRemote.makeWith` builds a remote from two functions: one
 * that encodes outgoing entries and one that decodes incoming changes. Use it
 * when a sync server expects a format other than the built-in ones, and to
 * handle the `EventLogRemoteError` a refused write fails with.
 */

import { Console, Effect, Layer, Queue, Schema, Stream } from 'effect'
import {
  EventJournal,
  EventLog,
  EventLogEncryption,
  EventLogMessage,
  EventLogRemote,
  EventLogServer,
} from 'effect/eventlog'
import { RpcTest } from 'effect/rpc'

// Suppose the sync server is written in another language and speaks JSON.
// These two codecs describe what goes into a write and what comes back as
// changes. `Schema.toCodecJson` turns the binary fields into base64 text.
const JsonWrite = Schema.fromJsonString(
  Schema.toCodecJson(
    Schema.Struct({
      publicKey: Schema.String,
      storeId: Schema.String,
      entries: Schema.Array(EventJournal.Entry),
    }),
  ),
)
const JsonChanges = Schema.fromJsonString(
  Schema.toCodecJson(Schema.Array(EventJournal.RemoteEntry)),
)
const toBytes = (text: string) => Uint8Array.from(text, (c) => c.charCodeAt(0))
const toText = (bytes: Uint8Array) => String.fromCharCode(...bytes)

// The remote. `makeWith` still runs the handshake, chunks large writes, and
// registers itself with the event log's `Registry`. Only the bytes are ours.
const JsonRemote = Layer.effect(
  EventLogRemote.EventLogRemote,
  EventLogRemote.makeWith({
    encodeWrite: ({ identity, storeId, entries }) =>
      Schema.encodeEffect(JsonWrite)({
        publicKey: identity.publicKey,
        storeId,
        entries,
      }).pipe(Effect.map(toBytes)),
    decodeChanges: (_identity, data) =>
      Schema.decodeEffect(JsonChanges)(toText(data)),
  }),
)

// A stand-in for that server, built on `EventLogServer.layerRpcHandlers`.
// It keeps entries in memory and only knows the store "todos". A write to
// any other store is refused with an `EventLogProtocolError`.
const ServerLive = Layer.unwrap(
  Effect.sync(() => {
    const stored: Array<EventJournal.RemoteEntry> = []
    const signingKeys = new Map<string, Uint8Array<ArrayBuffer>>()
    return EventLogServer.layerRpcHandlers({
      remoteId: EventJournal.makeRemoteIdUnsafe(),
      getOrCreateSessionAuthBinding: (publicKey, signingPublicKey) =>
        Effect.sync(() => {
          const known = signingKeys.get(publicKey) ?? signingPublicKey
          signingKeys.set(publicKey, known)
          return known
        }),
      onWrite: (data) =>
        Effect.gen(function* () {
          const write = yield* Schema.decodeEffect(JsonWrite)(toText(data))
          if (write.storeId !== 'todos') {
            return yield* new EventLogMessage.EventLogProtocolError({
              requestTag: 'WriteEntries',
              publicKey: write.publicKey,
              code: 'NotFound',
              message: `No store named ${write.storeId}`,
            })
          }
          for (const entry of write.entries) {
            stored.push(
              new EventJournal.RemoteEntry({
                remoteSequence: stored.length,
                entry,
              }),
            )
          }
        }).pipe(Effect.catchTag('SchemaError', Effect.die)),
      changes: () =>
        Stream.fromEffect(
          Schema.encodeEffect(JsonChanges)(stored).pipe(Effect.map(toBytes)),
        ),
    })
  }),
)

// Every remote operation fails with `EventLogRemoteError`. `method` names the
// operation and `cause` holds what went wrong underneath. When the server
// refused, that is its `EventLogProtocolError`, whose `code` says why.
const explain = (error: EventLogRemote.EventLogRemoteError) =>
  EventLogMessage.EventLogProtocolError.is(error.cause)
    ? `${error.method} refused: ${error.cause.code}, ${error.cause.message}`
    : `${error.method} failed`

export const program = Effect.gen(function* () {
  // The layer provides the remote as the `EventLogRemote` service. An event
  // log would use it through the `Registry`; here we call it directly.
  const identity = yield* EventLog.makeIdentity
  const remote = yield* EventLogRemote.EventLogRemote
  const entry = new EventJournal.Entry({
    id: EventJournal.makeEntryIdUnsafe(),
    event: 'TodoAdded',
    primaryKey: 'todo-1',
    payload: new Uint8Array([1, 2, 3]),
  })

  // A write to a known store succeeds, and reading the changes runs the
  // JSON through `decodeChanges` back into journal entries.
  const todos = EventLogMessage.StoreId.make('todos')
  yield* remote.write({ identity, storeId: todos, entries: [entry] })
  const changes = yield* remote.changes({
    identity,
    storeId: todos,
    startSequence: 0,
  })
  const [received] = yield* Queue.takeN(changes, 1)
  if (received !== undefined) {
    yield* Console.log(received.entry.event, [...received.entry.payload])
  }

  // A write to an unknown store is refused. The remote retries a
  // `Forbidden` reply by authenticating again; any other code fails at once.
  const notes = EventLogMessage.StoreId.make('notes')
  yield* remote
    .write({ identity, storeId: notes, entries: [entry] })
    .pipe(
      Effect.catchTag('EventLogRemoteError', (error) =>
        Console.log(explain(error)),
      ),
    )
}).pipe(
  // `RpcTest` connects the remote's RPC client to the server in memory. The
  // encryption layer is only there for `EventLog.makeIdentity`.
  Effect.scoped,
  Effect.provide(
    JsonRemote.pipe(
      Layer.provide(
        Layer.effect(
          EventLogRemote.EventLogRemoteClient,
          RpcTest.makeClient(EventLogMessage.EventLogRemoteRpcs),
        ),
      ),
      Layer.provide(ServerLive),
      Layer.provideMerge(EventLog.layerRegistry),
      Layer.provideMerge(EventLogEncryption.layerSubtle),
    ),
  ),
)
