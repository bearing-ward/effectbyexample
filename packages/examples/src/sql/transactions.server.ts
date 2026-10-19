/**
 * @title Transactions
 * @difficulty intermediate
 * @summary `sql.withTransaction` runs an effect inside a database
 * transaction. It commits when the effect succeeds and rolls back when it
 * fails, so a half-finished transfer never reaches the database.
 */

import { SqliteClient } from '@effect/sql-sqlite-node'
import { Console, Effect, Schema } from 'effect'
import { SqlClient, SqlConnection } from 'effect/sql'

class InsufficientFunds extends Schema.TaggedError<InsufficientFunds>()(
  'InsufficientFunds',
  { account: Schema.String },
) {}

export const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`CREATE TABLE accounts (name TEXT PRIMARY KEY, balance INTEGER NOT NULL)`
  yield* sql`INSERT INTO accounts ${sql.insert([
    { name: 'alice', balance: 100 },
    { name: 'bob', balance: 20 },
  ])}`

  const balances = sql<{ name: string; balance: number }>`
    SELECT name, balance FROM accounts ORDER BY name
  `.pipe(Effect.map((rows) => rows.map((row) => `${row.name}=${row.balance}`)))

  // A transfer is two updates. The check runs between them, so a failure
  // leaves the first update applied unless both share a transaction.
  const transfer = (from: string, to: string, amount: number) =>
    Effect.gen(function* () {
      yield* sql`UPDATE accounts SET balance = balance + ${amount} WHERE name = ${to}`
      const [row] = yield* sql<{ balance: number }>`
        UPDATE accounts SET balance = balance - ${amount}
        WHERE name = ${from} RETURNING balance
      `
      if (row === undefined || row.balance < 0) {
        return yield* new InsufficientFunds({ account: from })
      }
    }).pipe(sql.withTransaction)

  // The first transfer commits.
  yield* transfer('alice', 'bob', 30)
  yield* Console.log(yield* balances)

  // The second fails after crediting alice. The error still reaches us as a
  // typed `InsufficientFunds`, and the credit was rolled back.
  const failed = yield* transfer('bob', 'alice', 500).pipe(
    Effect.as('transferred'),
    Effect.catchTag('InsufficientFunds', (error) =>
      Effect.succeed(`${error._tag}: ${error.account}`),
    ),
  )
  yield* Console.log(failed)
  yield* Console.log(yield* balances)

  // Transactions nest. The inner one becomes a savepoint, so its failure
  // undoes only its own work and the outer transaction can carry on.
  yield* Effect.gen(function* () {
    yield* transfer('alice', 'bob', 10)
    yield* transfer('bob', 'alice', 999).pipe(
      Effect.catchTag('InsufficientFunds', () => Effect.void),
    )
  }).pipe(sql.withTransaction)
  yield* Console.log(yield* balances)

  // A transaction runs every statement on one connection. When you need that
  // without a transaction, for example for a TEMP table that exists only on
  // one connection, reserve a connection yourself. A
  // `SqlConnection.Connection` runs SQL strings with parameters, and is
  // released when the scope closes.
  const report = yield* Effect.gen(function* () {
    const connection: SqlConnection.Connection = yield* sql.reserve
    yield* connection.execute(
      'CREATE TEMP TABLE big_accounts AS SELECT name FROM accounts WHERE balance > ?',
      [50],
      undefined,
    )
    return yield* connection.executeValues('SELECT name FROM big_accounts', [])
  }).pipe(Effect.scoped)
  yield* Console.log(report)
}).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' })))
