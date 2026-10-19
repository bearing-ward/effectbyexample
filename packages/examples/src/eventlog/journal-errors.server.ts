/**
 * @title Journal errors
 * @difficulty intermediate
 * @summary Journal operations that hit storage can fail with
 * `EventJournalError`. The error names the journal method that failed and
 * keeps the storage error as its cause, so you can handle it like any other
 * typed failure.
 */

import { SqliteClient } from '@effect/sql-sqlite-node'
import { Console, Effect } from 'effect'
import { EventJournal, SqlEventJournal } from 'effect/eventlog'
import { SqlError } from 'effect/sql'

export const program = Effect.gen(function* () {
  // `SqlEventJournal.make` builds the journal service directly, creating
  // its tables if needed. `SqlEventJournal.layer` wraps it as a layer. The
  // table names are options, for keeping several journals in one database.
  const journal = yield* SqlEventJournal.make({
    entryTable: 'orders_journal',
    remotesTable: 'orders_remotes',
  })

  yield* journal.write({
    event: 'OrderPlaced',
    primaryKey: 'order-1',
    payload: new Uint8Array([1]),
    effect: () => Effect.void,
  })
  yield* Console.log(`entries: ${(yield* journal.entries).length}`)

  // `destroy` drops the tables, for example when a user signs out and their
  // local data must go. Using the journal afterwards fails, because its
  // tables are gone.
  yield* journal.destroy
  const error = yield* journal.entries.pipe(Effect.flip)

  // The `EventJournalError` tells you which method failed. It is a class,
  // so `instanceof` recognises it even in code that only sees `unknown`,
  // such as an error reporter. Its `cause` is the error from the storage
  // layer, here a `SqlError` from SQLite.
  const report = (failure: unknown) =>
    failure instanceof EventJournal.EventJournalError
      ? `journal failed in ${failure.method}`
      : 'unexpected failure'
  yield* Console.log(report(error))
  yield* Console.log(
    `caused by a SqlError: ${SqlError.isSqlError(error.cause)}`,
  )

  // As a tagged error it works with `Effect.catchTag`. Here a read falls
  // back to an empty list.
  const entries = yield* journal.entries.pipe(
    Effect.catchTag('EventJournalError', () =>
      Effect.succeed<ReadonlyArray<EventJournal.Entry>>([]),
    ),
  )
  yield* Console.log(`entries after destroy: ${entries.length}`)
}).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' })))
