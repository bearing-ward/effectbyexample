/**
 * @title A sync server in SQL
 * @difficulty advanced
 * @summary The sync servers keep their entries in a `Storage` service. The
 * SQL storage layers put it in a database, so the server keeps every
 * device's history across restarts. The unencrypted server stores readable
 * rows; the encrypted one stores only ciphertext.
 */

import { SqliteClient } from '@effect/sql-sqlite-node'
import { Console, Context, Effect, Layer, Schedule, Schema } from 'effect'
import {
  EventGroup,
  EventJournal,
  EventLog,
  EventLogEncryption,
  EventLogMessage,
  EventLogRemote,
  EventLogServerEncrypted,
  EventLogServerUnencrypted,
  SqlEventLogServerEncrypted,
  SqlEventLogServerUnencrypted,
} from 'effect/eventlog'
import { RpcTest } from 'effect/rpc'
import { SqlClient } from 'effect/sql'

const NoteEvents = EventGroup.empty.add({
  tag: 'NoteWritten',
  primaryKey: (note) => note.id,
  payload: Schema.Struct({ id: Schema.String, text: Schema.String }),
})
const NoteLog = EventLog.schema(NoteEvents)
const noteHandlers = EventLog.group(NoteEvents, (handlers) =>
  handlers.handle('NoteWritten', () => Effect.void),
)

// The unencrypted server, as in "Syncing devices", with SQL storage in
// place of memory. It sees plaintext, so it can run handlers of its own.
const PlainServer = EventLogServerUnencrypted.layerNoRpcServer(
  NoteLog,
  noteHandlers,
).pipe(
  Layer.provide(SqlEventLogServerUnencrypted.layerStorage()),
  Layer.provide(
    EventLogServerUnencrypted.layerStoreMappingStatic({
      storeId: EventLogMessage.StoreId.make('default'),
    }),
  ),
  Layer.provide(
    Layer.succeed(EventLogServerUnencrypted.EventLogServerAuthorization, {
      authorizeWrite: () => Effect.void,
      authorizeRead: () => Effect.void,
      authorizeIdentity: () => Effect.void,
    }),
  ),
  Layer.provide(EventLog.layerRegistry),
)

// The encrypted server only relays. `layerStorageSubtle` stores the
// ciphertext in SQL and hashes table names with Web Crypto.
const SealedServer = EventLogServerEncrypted.layerRpcHandlers.pipe(
  Layer.provide(SqlEventLogServerEncrypted.layerStorageSubtle()),
)

// Two devices of one user sync a note through a server: the laptop writes
// it, and we wait until the phone has it. `makeRemote` picks the encrypted
// or unencrypted protocol to match the server.
const syncOneNote = <A, E, R>(
  serverLive: Layer.Layer<A, E, R>,
  makeRemote: typeof EventLogRemote.makeEncrypted,
  identity: EventLog.Identity['Service'],
) =>
  Effect.gen(function* () {
    const server = yield* Layer.build(serverLive)
    const connect = Layer.build(
      EventLog.layer(NoteLog, noteHandlers).pipe(
        Layer.provideMerge(
          Layer.effectDiscard(
            Effect.gen(function* () {
              const client = yield* RpcTest.makeClient(
                EventLogMessage.EventLogRemoteRpcs,
              )
              yield* makeRemote.pipe(
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
        Layer.provide(Layer.succeed(EventLog.Identity, identity)),
        Layer.provide(Layer.succeedContext(server)),
      ),
    ).pipe(Effect.map(Context.get(EventLog.EventLog)))
    const laptop = yield* connect
    const phone = yield* connect
    yield* laptop.write({
      schema: NoteLog,
      event: 'NoteWritten',
      payload: { id: 'note-1', text: 'wifi password is hunter2' },
    })
    yield* phone.entries.pipe(
      Effect.repeat({
        until: (entries) => entries.length === 1,
        schedule: Schedule.spaced('1 millis'),
      }),
    )
  }).pipe(Effect.scoped)

// Bytes as text, to search them for the note.
const asText = (bytes: Uint8Array) => String.fromCharCode(...bytes)

export const program = Effect.gen(function* () {
  const identity = yield* EventLog.makeIdentity

  // Unencrypted: the server's table holds the event name, the primary key,
  // and a payload anyone with database access can read.
  yield* Effect.gen(function* () {
    yield* syncOneNote(PlainServer, EventLogRemote.makeUnencrypted, identity)
    const sql = yield* SqlClient.SqlClient
    const rows = yield* sql<{
      event: string
      primary_key: string
      payload: Uint8Array
    }>`
      SELECT event, primary_key, payload FROM effect_events
    `
    yield* Console.log(
      rows.map((row) => [
        row.event,
        row.primary_key,
        asText(row.payload).includes('hunter2'),
      ]),
    )
  }).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' })))

  // Encrypted: each identity and store gets its own table, named by a hash
  // of the two. Rows hold a sequence number, the entry id, an
  // initialisation vector, and ciphertext.
  yield* Effect.gen(function* () {
    yield* syncOneNote(SealedServer, EventLogRemote.makeEncrypted, identity)
    const sql = yield* SqlClient.SqlClient
    const tables = yield* sql<{ name: string }>`
      SELECT name FROM sqlite_master
      WHERE type = 'table' AND name LIKE 'effect_events_%' ORDER BY name
    `
    yield* Console.log(
      tables.map((table) => table.name.replace(/_[0-9a-f]{16}$/, '_<hash>')),
    )
    const sealed = tables.find((table) => /_[0-9a-f]{16}$/.test(table.name))
    if (sealed === undefined) return
    const rows = yield* sql<{ encrypted_entry: Uint8Array }>`
      SELECT * FROM ${sql(sealed.name)}
    `
    yield* Console.log(
      Object.keys(rows[0] ?? {}),
      rows.some((row) => asText(row.encrypted_entry).includes('hunter2')),
    )
  }).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' })))
}).pipe(Effect.provide(EventLogEncryption.layerSubtle))
