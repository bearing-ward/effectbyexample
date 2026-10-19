/**
 * @title Moving a sync server to SQL
 * @difficulty advanced
 * @summary A server that started with in-memory storage can move its data
 * into SQL storage without any device noticing. The storage services are
 * plain values with `write` and `changes`, so a copy is a read from one and
 * a write to the other. The encrypted server copies ciphertext it cannot
 * read.
 */

import { SqliteClient } from '@effect/sql-sqlite-node'
import {
  Console,
  Context,
  Effect,
  Layer,
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
const storeId = EventLogMessage.StoreId.make('default')

// A device of `identity` connected to an encrypted server built on
// `storage`, in memory as in "End-to-end encrypted sync".
const connect = <E, R>(
  identity: EventLog.Identity['Service'],
  storage: Layer.Layer<EventLogServerEncrypted.Storage, E, R>,
) =>
  Layer.build(
    EventLog.layer(
      NoteLog,
      EventLog.group(NoteEvents, (handlers) =>
        handlers.handle('NoteWritten', () => Effect.void),
      ),
    ).pipe(
      Layer.provideMerge(
        Layer.effectDiscard(
          Effect.flatMap(
            RpcTest.makeClient(EventLogMessage.EventLogRemoteRpcs),
            (client) =>
              EventLogRemote.makeEncrypted.pipe(
                Effect.provideService(
                  EventLogRemote.EventLogRemoteClient,
                  client,
                ),
              ),
          ),
        ),
      ),
      Layer.provide(EventLog.layerRegistry),
      Layer.provide(EventJournal.layerMemory),
      Layer.provide(Layer.succeed(EventLog.Identity, identity)),
      Layer.provide(EventLogServerEncrypted.layerRpcHandlers),
      Layer.provide(storage),
    ),
  ).pipe(Effect.map(Context.get(EventLog.EventLog)))

const waitFor = (log: EventLog.EventLog['Service'], count: number) =>
  log.entries.pipe(
    Effect.repeat({
      until: (entries) => entries.length === count,
      schedule: Schedule.spaced('1 millis'),
    }),
  )

// Each part gets its own fresh SQLite database.
const database = SqliteClient.layer({ filename: ':memory:' })

const moveEncrypted = Effect.gen(function* () {
  const identity = yield* EventLog.makeIdentity

  // Encrypted: a laptop syncs two notes to the old, in-memory server.
  const memory = yield* EventLogServerEncrypted.makeStorageMemory
  const laptop = yield* connect(
    identity,
    Layer.succeed(EventLogServerEncrypted.Storage, memory),
  )
  for (const text of ['Gate code 1234', 'Water the plants']) {
    yield* laptop.write({
      schema: NoteLog,
      event: 'NoteWritten',
      payload: { id: text, text },
    })
  }

  // The migration script opens the SQL storage with `makeStorage`, which
  // needs a `SqlClient` and `EventLogEncryption` (it hashes table names).
  // Storage has no "list everything", so a real migration walks its own
  // list of accounts and stores. Each stored entry becomes a
  // `PersistedEntry`: id, initialisation vector, ciphertext.
  const sql = yield* SqlEventLogServerEncrypted.makeStorage()
  const copied = yield* memory
    .changes(identity.publicKey, storeId, 0)
    .pipe(Stream.take(2), Stream.runCollect)
  yield* sql.write(
    identity.publicKey,
    storeId,
    copied.map(
      (entry) =>
        new EventLogServerEncrypted.PersistedEntry({
          entryId: entry.entryId,
          iv: entry.iv,
          encryptedEntry: entry.encryptedEntry,
        }),
    ),
  )

  // The new server is an ordinary server with `layerStorage` on the same
  // database. A new phone connects to it and decrypts both notes with the
  // identity's key.
  const phone = yield* connect(
    identity,
    SqlEventLogServerEncrypted.layerStorage(),
  )
  yield* waitFor(phone, 2)
  yield* Console.log('phone has', (yield* phone.entries).length, 'notes')
}).pipe(Effect.scoped, Effect.provide(database))

const moveUnencrypted = Effect.gen(function* () {
  // Unencrypted: the server writes two notes itself, then they move to SQL
  // storage built with `SqlEventLogServerUnencrypted.makeStorage`. These
  // entries are plain `Entry` values, so they copy as they are.
  const plainMemory = yield* EventLogServerUnencrypted.makeStorageMemory
  const write = (yield* EventLogServerUnencrypted.make.pipe(
    Effect.provideService(EventLogServerUnencrypted.Storage, plainMemory),
    Effect.provide(EventLog.layerRegistry),
  )).makeWrite(NoteLog)
  yield* write({
    storeId,
    event: 'NoteWritten',
    payload: { id: 'n1', text: 'Milk' },
  })
  yield* write({
    storeId,
    event: 'NoteWritten',
    payload: { id: 'n2', text: 'Eggs' },
  })
  const plainSql = yield* SqlEventLogServerUnencrypted.makeStorage()
  const plainEntries = yield* plainMemory
    .changes({ storeId, startSequence: 0, compactors: new Map() })
    .pipe(Stream.take(2), Stream.runCollect)
  yield* plainSql.write(
    storeId,
    plainEntries.map((remote) => remote.entry),
  )
  const rows = yield* (yield* SqlClient.SqlClient)<{ primary_key: string }>`
    SELECT primary_key FROM effect_events ORDER BY sequence
  `
  yield* Console.log(
    'rows:',
    rows.map((row) => row.primary_key),
  )
}).pipe(Effect.scoped, Effect.provide(database))

export const program = Effect.gen(function* () {
  yield* moveEncrypted
  yield* moveUnencrypted
}).pipe(Effect.provide(EventLogEncryption.layerSubtle))
