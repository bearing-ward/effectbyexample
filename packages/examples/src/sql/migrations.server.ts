/**
 * @title Migrations
 * @difficulty intermediate
 * @summary `Migrator` brings a database schema up to date. Each migration is
 * an effect with a numeric id. The migrator records which ids have run and
 * applies only the new ones, inside a transaction.
 */

import { SqliteClient } from '@effect/sql-sqlite-node'
import { Console, Effect } from 'effect'
import { Migrator, SqlClient } from 'effect/sql'

// Migrations are keyed `<id>_<name>` and run in id order. A real application
// keeps one migration per file and loads the directory with
// `Migrator.fromFileSystem`; `fromRecord` keeps them inline.
const firstRelease = {
  '0001_create_customers': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`CREATE TABLE customers (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`
  }),
  '0002_add_email': Effect.gen(function* () {
    const sql = yield* SqlClient.SqlClient
    yield* sql`ALTER TABLE customers ADD COLUMN email TEXT`
  }),
}

// `Migrator.make` builds a runner. Driver packages wrap it, for example
// `SqliteMigrator.run`, to add dialect extras such as schema dumps.
const migrate = Migrator.make({})

export const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // The first run applies everything and returns what it ran.
  const applied = yield* migrate({ loader: Migrator.fromRecord(firstRelease) })
  yield* Console.log(applied)

  // Running again is safe: everything is already recorded, so nothing runs.
  yield* Console.log(
    yield* migrate({ loader: Migrator.fromRecord(firstRelease) }),
  )

  // The record lives in a table, `effect_sql_migrations` by default.
  const recorded = yield* sql`
    SELECT migration_id, name FROM effect_sql_migrations ORDER BY migration_id
  `
  yield* Console.log(recorded)

  // A new release adds a migration. Only that one runs.
  const secondRelease = {
    ...firstRelease,
    '0003_add_signup_source': Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE customers ADD COLUMN source TEXT`
    }),
  }
  yield* Console.log(
    yield* migrate({ loader: Migrator.fromRecord(secondRelease) }),
  )

  // A failing migration is a defect: the program should not start against a
  // half-migrated database. The run is one transaction, so the step before
  // the failure is rolled back and nothing is recorded.
  const broken = {
    ...secondRelease,
    '0004_add_phone': Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE customers ADD COLUMN phone TEXT`
    }),
    '0005_typo': Effect.gen(function* () {
      const sql = yield* SqlClient.SqlClient
      yield* sql`ALTER TABLE customerz ADD COLUMN notes TEXT`
    }),
  }
  const outcome = yield* migrate({ loader: Migrator.fromRecord(broken) }).pipe(
    Effect.as('migrated'),
    Effect.catchDefect((defect) =>
      Effect.succeed(
        defect instanceof Migrator.MigrationError
          ? `${defect.kind}: ${defect.message}`
          : 'unexpected defect',
      ),
    ),
  )
  yield* Console.log(outcome)

  // The `phone` column from 0004 is gone, and the latest recorded migration
  // is still 3. The next deploy, with the typo fixed, will run 4 and 5.
  const columns = yield* sql<{ name: string }>`
    SELECT name FROM pragma_table_info('customers')
  `
  yield* Console.log(columns.map((column) => column.name))
  const latest =
    yield* sql`SELECT max(migration_id) AS latest FROM effect_sql_migrations`
  yield* Console.log(latest)
}).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' })))
