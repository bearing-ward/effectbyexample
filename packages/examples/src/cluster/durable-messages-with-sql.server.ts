/**
 * @title Surviving a restart with SQL storage
 * @difficulty advanced
 * @summary In-memory storage forgets everything when the process stops.
 * `SingleRunner` runs a one-process cluster whose messages live in a SQL
 * database, so a message sent before a shutdown is still delivered after the
 * next start.
 */

import { NodeCrypto } from '@effect/platform-node'
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Console, DateTime, Deferred, Effect, Layer, Schema } from 'effect'
import { ClusterSchema, DeliverAt, Entity, SingleRunner } from 'effect/cluster'
import { Rpc } from 'effect/rpc'
import { SqlClient } from 'effect/sql'

// A reminder due shortly after it is sent, so the process can stop before
// it is delivered.
class Reminder extends Schema.Class<Reminder>('Reminder')({
  text: Schema.String,
  sendAt: Schema.DateTimeUtc,
}) {
  [DeliverAt.symbol]() {
    return this.sendAt
  }
}
const Remind = Rpc.make('Remind', { payload: Reminder }).annotate(
  ClusterSchema.Persisted,
  true,
)
const Inbox = Entity.make('Inbox', [Remind])

export const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  const delivered = yield* Deferred.make<string>()

  const InboxLive = Inbox.toLayer(
    Inbox.of({
      Remind: ({ payload }) =>
        Effect.asVoid(Deferred.succeed(delivered, payload.text)),
    }),
  )

  // `SingleRunner.layer` stores messages with `SqlMessageStorage` and runner
  // state with `SqlRunnerStorage`, creating their tables on first use. It
  // needs a `SqlClient`, and `Crypto` for hashing long message keys. Its
  // configuration comes from the environment, with these overrides on top.
  const Runner = InboxLive.pipe(
    Layer.provideMerge(
      SingleRunner.layer({
        shardingConfig: { entityMessagePollInterval: '50 millis' },
      }),
    ),
  )

  const messages = sql<{ entity_id: string; tag: string; processed: number }>`
    SELECT entity_id, tag, processed FROM cluster_messages
  `

  // First run: send the reminder, then shut the runner down at once.
  yield* Effect.gen(function* () {
    const inbox = (yield* Inbox.client)('user-1')
    const now = yield* DateTime.now
    yield* inbox.Remind(
      new Reminder({
        text: 'renew passport',
        sendAt: DateTime.add(now, { milliseconds: 200 }),
      }),
      { discard: true },
    )
    yield* Console.log('first run: reminder sent, shutting down')
  }).pipe(Effect.provide(Runner))

  // Between runs, the message waits in the database, not yet processed.
  const tables = yield* sql<{ name: string }>`
    SELECT name FROM sqlite_master WHERE type = 'table' AND name LIKE 'cluster_%'
    ORDER BY name
  `
  yield* Console.log(`tables: ${tables.map((table) => table.name).join(', ')}`)
  for (const row of yield* messages) {
    yield* Console.log(
      `stored: ${row.tag} for ${row.entity_id}, processed=${row.processed}`,
    )
  }

  // Second run on the same database: the runner reads unprocessed messages
  // from storage and delivers the reminder once it is due.
  yield* Effect.gen(function* () {
    yield* Console.log(
      `second run: delivered "${yield* Deferred.await(delivered)}"`,
    )
  }).pipe(Effect.provide(Runner))

  for (const row of yield* messages) {
    yield* Console.log(
      `stored: ${row.tag} for ${row.entity_id}, processed=${row.processed}`,
    )
  }
}).pipe(
  // The database outlives both runs. An in-memory SQLite database stands in
  // for a file or a Postgres server.
  Effect.provide([
    SqliteClient.layer({ filename: ':memory:' }),
    NodeCrypto.layer,
  ]),
)
