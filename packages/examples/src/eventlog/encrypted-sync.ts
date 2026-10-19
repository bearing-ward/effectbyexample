/**
 * @title End-to-end encrypted sync
 * @difficulty advanced
 * @summary With the encrypted server, devices encrypt every entry before it
 * leaves them, using a key that only the user's devices hold. The server
 * stores and relays ciphertext, so it can sync data it cannot read.
 */

import {
  Console,
  Context,
  Effect,
  Layer,
  Ref,
  Schedule,
  Schema,
  Stream,
} from 'effect'
import {
  EventGroup,
  EventJournal,
  EventLog,
  EventLogEncryption,
  EventLogMessage,
  EventLogRemote,
  EventLogServerEncrypted,
} from 'effect/eventlog'
import { RpcTest } from 'effect/rpc'

const NoteEvents = EventGroup.empty.add({
  tag: 'NoteWritten',
  primaryKey: (note) => note.id,
  payload: Schema.Struct({ id: Schema.String, text: Schema.String }),
})
const NoteLog = EventLog.schema(NoteEvents)

// The server needs no schema and no handlers: it never decodes an event.
// It stores encrypted entries per public key and store id. Storage is in
// memory here; `SqlEventLogServerEncrypted` keeps it in a database.
const ServerLive = EventLogServerEncrypted.layerRpcHandlers.pipe(
  Layer.provideMerge(EventLogServerEncrypted.layerStorageMemory),
)

// A device encrypts with `EventLogRemote.makeEncrypted`. The key comes from
// the private half of the user's `Identity`, which is never sent to the
// server. `RpcTest` connects to the server in memory; an app uses
// `EventLogRemote.layerEncrypted` with an RPC protocol such as a WebSocket.
const device = (
  name: string,
  identity: EventLog.Identity['Service'],
  seen: Ref.Ref<ReadonlyArray<string>>,
) =>
  EventLog.layer(
    NoteLog,
    EventLog.group(NoteEvents, (handlers) =>
      handlers.handle('NoteWritten', ({ payload }) =>
        Ref.update(seen, (notes) => [...notes, `${name}: ${payload.text}`]),
      ),
    ),
  ).pipe(
    Layer.provideMerge(
      Layer.effectDiscard(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(
            EventLogMessage.EventLogRemoteRpcs,
          )
          yield* EventLogRemote.makeEncrypted.pipe(
            Effect.provideService(EventLogRemote.EventLogRemoteClient, client),
          )
        }),
      ),
    ),
    Layer.provide(EventLog.layerRegistry),
    Layer.provide(EventJournal.layerMemory),
    Layer.provide(Layer.succeed(EventLog.Identity, identity)),
  )

// Bytes as text, to search them for the note.
const asText = (bytes: Uint8Array) => String.fromCharCode(...bytes)

export const program = Effect.gen(function* () {
  // An identity is a public key, which names the user to the server, and a
  // private key, from which the encryption key is derived. Both devices of
  // this user share it, for example by scanning a QR code.
  const identity = yield* EventLog.makeIdentity
  const seen = yield* Ref.make<ReadonlyArray<string>>([])

  const server = yield* Layer.build(ServerLive)
  const connect = (name: string) =>
    Layer.build(
      device(name, identity, seen).pipe(
        Layer.provide(Layer.succeedContext(server)),
      ),
    ).pipe(Effect.map(Context.get(EventLog.EventLog)))

  const laptop = yield* connect('laptop')
  const phone = yield* connect('phone')

  // Writing works as usual. The laptop encrypts the entry before sending it.
  yield* laptop.write({
    schema: NoteLog,
    event: 'NoteWritten',
    payload: { id: 'note-1', text: 'door code is 4711' },
  })
  yield* phone.entries.pipe(
    Effect.repeat({
      until: (entries) => entries.length === 1,
      schedule: Schedule.spaced('1 millis'),
    }),
  )

  // The phone decrypted the entry and ran its handler.
  yield* Console.log(yield* Ref.get(seen))

  // Look at what the server stored: a sequence number, the entry id, an
  // initialisation vector, and ciphertext. The note's text is not in it.
  const storage = Context.get(server, EventLogServerEncrypted.Storage)
  const [stored] = yield* storage
    .changes(identity.publicKey, EventLogMessage.StoreId.make('default'), 0)
    .pipe(Stream.take(1), Stream.runCollect)
  if (stored !== undefined) {
    yield* Console.log(Object.keys(stored))
    yield* Console.log(asText(stored.encryptedEntry).includes('4711'))
  }

  // For comparison, the phone's own journal holds the payload in the clear.
  const [local] = yield* phone.entries
  if (local !== undefined) {
    yield* Console.log(asText(local.payload).includes('4711'))
  }
}).pipe(Effect.scoped, Effect.provide(EventLogEncryption.layerSubtle))
