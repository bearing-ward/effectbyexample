/**
 * @title A journal in SQL
 * @difficulty intermediate
 * @summary `SqlEventJournal` stores the event log's journal in any database
 * that Effect SQL supports. Entries survive restarts, and they are ordinary
 * rows you can inspect with SQL.
 */

import { SqliteClient } from '@effect/sql-sqlite-node'
import { Console, Effect, Layer, Schema } from 'effect'
import {
  EventGroup,
  EventJournal,
  EventLog,
  EventLogEncryption,
  SqlEventJournal,
} from 'effect/eventlog'
import { SqlClient } from 'effect/sql'

const ExpenseEvents = EventGroup.empty.add({
  tag: 'ExpenseRecorded',
  primaryKey: (expense) => expense.id,
  payload: Schema.Struct({ id: Schema.String, cents: Schema.Int }),
})
const ExpenseLog = EventLog.schema(ExpenseEvents)

// The log for one run of the app. The handler does nothing here; the point
// is where the entries go. `SqlEventJournal.layer` creates its tables on
// first use and needs only a `SqlClient`.
const AppLog = EventLog.layer(
  ExpenseLog,
  EventLog.group(ExpenseEvents, (handlers) =>
    handlers.handle('ExpenseRecorded', () => Effect.void),
  ),
).pipe(
  Layer.provide(EventLog.layerRegistry),
  Layer.provide(SqlEventJournal.layer()),
  Layer.provide(Layer.effect(EventLog.Identity, EventLog.makeIdentity)),
  Layer.provide(EventLogEncryption.layerSubtle),
)

export const program = Effect.gen(function* () {
  // First run: record two expenses.
  yield* Effect.gen(function* () {
    const write = yield* EventLog.makeClient(ExpenseLog)
    yield* write('ExpenseRecorded', { id: 'exp-1', cents: 1250 })
    yield* write('ExpenseRecorded', { id: 'exp-2', cents: 499 })
  }).pipe(Effect.provide(AppLog))

  // Second run: a new journal over the same database finds the entries from
  // before.
  const entries = yield* Effect.gen(function* () {
    const journal = yield* EventJournal.EventJournal
    return yield* journal.entries
  }).pipe(Effect.provide(SqlEventJournal.layer()))
  yield* Console.log(
    entries.map((entry) => `${entry.event} ${entry.primaryKey}`).toSorted(),
  )

  // The journal is a table, `effect_event_journal` by default. The payload
  // column holds the event's binary encoding.
  const sql = yield* SqlClient.SqlClient
  const rows = yield* sql<{ event: string; primary_key: string; size: number }>`
    SELECT event, primary_key, length(payload) AS size
    FROM effect_event_journal ORDER BY primary_key
  `
  yield* Console.log(rows)
}).pipe(
  // A file-backed database survives a real restart. In memory, the database
  // lives as long as this layer, which spans both runs.
  Effect.provide(SqliteClient.layer({ filename: ':memory:' })),
)
