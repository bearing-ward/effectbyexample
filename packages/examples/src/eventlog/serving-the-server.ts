/**
 * @title Serving a sync server
 * @difficulty advanced
 * @summary The other sync examples call the server's handlers directly.
 * In an app, `EventLogServerUnencrypted.layer` and
 * `EventLogServerEncrypted.layer` run a full RPC server on whatever
 * `RpcServer.Protocol` you provide, and devices connect with
 * `EventLogRemote.layerUnencrypted` or `layerEncrypted` over the matching
 * `RpcClient.Protocol`.
 */

import { Console, Context, Effect, Layer, Queue, Schema, Stream } from 'effect'
import {
  EventGroup,
  EventJournal,
  EventLog,
  EventLogEncryption,
  EventLogMessage,
  EventLogRemote,
  EventLogServerEncrypted,
  EventLogServerUnencrypted,
} from 'effect/eventlog'
import { RpcClient, RpcMessage, RpcSerialization, RpcServer } from 'effect/rpc'

const NoteEvents = EventGroup.empty.add({
  tag: 'NoteWritten',
  primaryKey: (note) => note.id,
  payload: Schema.Struct({ id: Schema.String, text: Schema.String }),
})
const NoteLog = EventLog.schema(NoteEvents)
const noteHandlers = EventLog.group(NoteEvents, (handlers) =>
  handlers.handle('NoteWritten', () => Effect.void),
)

// A real server uses `RpcServer.layerProtocolWebsocket` and devices use
// `RpcClient.layerProtocolSocket`. To stay in memory, this wire carries
// binary frames between client and server, as in "Writing a transport".
// Each frame is tagged with the client's id, because the server keeps
// per-connection state, such as who has signed in, under that id.
const makeWire = Effect.gen(function* () {
  const serialization = yield* RpcSerialization.RpcSerialization
  const toServerParser = serialization.makeUnsafe()
  const toClientParser = serialization.makeUnsafe()
  const clientIds = new Set<number>()
  let toServer = (_id: number, _frame: Uint8Array) => Effect.void
  let toClient = (_id: number, _frame: Uint8Array) => Effect.void
  const server = yield* RpcServer.Protocol.make((write) => {
    toServer = (id, frame) =>
      Effect.forEach(
        toServerParser.decode(frame) as Array<RpcMessage.FromClientEncoded>,
        (message) => write(id, message),
        { discard: true },
      )
    return Effect.map(Queue.make<number>(), (disconnects) => ({
      disconnects,
      send: (id, message) =>
        toClient(id, toClientParser.encode(message) as Uint8Array),
      end: () => Effect.void,
      clientIds: Effect.sync(() => clientIds),
      initialMessage: Effect.succeedNone,
      supportsAck: true,
      supportsTransferables: false,
      supportsSpanPropagation: false,
      supportsNotifications: false,
      codecFor: serialization.codecFor,
    }))
  })
  const client = yield* RpcClient.Protocol.make((write) => {
    toClient = (id, frame) =>
      Effect.forEach(
        toClientParser.decode(frame) as Array<RpcMessage.FromServerEncoded>,
        (message) => write(id, message),
        { discard: true },
      )
    return Effect.succeed({
      send: (id, message) => {
        clientIds.add(id)
        return toServer(id, toServerParser.encode(message) as Uint8Array)
      },
      supportsAck: true,
      supportsTransferables: false,
      codecFor: serialization.codecFor,
    })
  })
  return {
    server: Layer.succeed(RpcServer.Protocol, server),
    client: Layer.succeed(RpcClient.Protocol, client),
  }
}).pipe(Effect.provide(RpcSerialization.layerSchemaBinary()))

// One device of `identity`, connected through `remote`.
const device = (
  identity: EventLog.Identity['Service'],
  remote: Layer.Layer<
    EventLogRemote.EventLogRemote,
    EventLogRemote.EventLogRemoteError,
    RpcClient.Protocol | EventLog.Registry
  >,
) =>
  Layer.build(
    EventLog.layer(NoteLog, noteHandlers).pipe(
      Layer.provideMerge(remote),
      Layer.provide(EventLog.layerRegistry),
      Layer.provide(EventJournal.layerMemory),
      Layer.provide(Layer.succeed(EventLog.Identity, identity)),
    ),
  ).pipe(Effect.map(Context.get(EventLog.EventLog)))

const note = {
  schema: NoteLog,
  event: 'NoteWritten',
  payload: { id: 'note-1', text: 'Call the plumber' },
} as const
const storeId = EventLogMessage.StoreId.make('default')

export const program = Effect.gen(function* () {
  const identity = yield* EventLog.makeIdentity

  // The unencrypted server: schema, handlers, storage, store mapping, and
  // authorization, as in "Syncing devices", plus a server protocol. The
  // layer outputs nothing; it runs until its scope closes, so we fork it.
  // We keep a handle on the storage to see what arrives.
  yield* Effect.gen(function* () {
    const wire = yield* makeWire
    const storage = yield* EventLogServerUnencrypted.makeStorageMemory
    yield* EventLogServerUnencrypted.layer(NoteLog, noteHandlers).pipe(
      Layer.provide([
        wire.server,
        Layer.succeed(EventLogServerUnencrypted.Storage, storage),
        EventLogServerUnencrypted.layerStoreMappingStatic({ storeId }),
        Layer.succeed(EventLogServerUnencrypted.EventLogServerAuthorization, {
          authorizeWrite: () => Effect.void,
          authorizeRead: () => Effect.void,
          authorizeIdentity: () => Effect.void,
        }),
      ]),
      Layer.launch,
      Effect.forkScoped,
    )
    const laptop = yield* device(
      identity,
      EventLogRemote.layerUnencrypted.pipe(Layer.provide(wire.client)),
    )
    yield* laptop.write(note)
    const [stored] = yield* storage
      .changes({ storeId, startSequence: 0, compactors: new Map() })
      .pipe(Stream.take(1), Stream.runCollect)
    yield* Console.log('unencrypted server stored', stored?.entry.event)
  }).pipe(Effect.scoped)

  // The encrypted server needs only storage and a protocol.
  yield* Effect.gen(function* () {
    const wire = yield* makeWire
    const storage = yield* EventLogServerEncrypted.makeStorageMemory
    yield* EventLogServerEncrypted.layer.pipe(
      Layer.provide([
        wire.server,
        Layer.succeed(EventLogServerEncrypted.Storage, storage),
      ]),
      Layer.launch,
      Effect.forkScoped,
    )
    const laptop = yield* device(
      identity,
      EventLogRemote.layerEncrypted.pipe(Layer.provide(wire.client)),
    )
    yield* laptop.write(note)
    const [stored] = yield* storage
      .changes(identity.publicKey, storeId, 0)
      .pipe(Stream.take(1), Stream.runCollect)
    yield* Console.log(
      'encrypted server stored',
      stored?.encryptedEntry.length,
      'bytes of ciphertext',
    )
  }).pipe(Effect.scoped)
}).pipe(Effect.provide(EventLogEncryption.layerSubtle))
