/**
 * @title Queries with the sql tag
 * @difficulty beginner
 * @summary `SqlClient` gives you a `sql` tagged template for writing queries.
 * Interpolated values are sent as bound parameters, never pasted into the SQL
 * text, so user input cannot change what a query does.
 */

// `effect/sql` defines the client interface, and a driver package provides
// it. This example uses SQLite through Node's built-in `node:sqlite`, with an
// in-memory database. The SQL modules are marked unstable, so their API can
// still change in a minor release.
import { SqliteClient } from '@effect/sql-sqlite-node'
import { Console, Effect } from 'effect'
import { SqlClient, Statement } from 'effect/sql'

export const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  // A statement is an Effect. Running it sends the query and returns the rows.
  yield* sql`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      role TEXT NOT NULL
    )
  `

  // `sql.insert` turns objects into a column list and a `VALUES` clause.
  yield* sql`INSERT INTO users ${sql.insert([
    { name: 'Ada', role: 'admin' },
    { name: 'Grace', role: 'member' },
    { name: 'Linus', role: 'member' },
  ])}`

  // An interpolated value becomes a `?` placeholder plus a parameter.
  // `compile` shows exactly what the driver receives. The quote trick in this
  // input is only a string, so it matches no user.
  const input = "Ada' OR '1'='1"
  const byName = sql`SELECT id, name FROM users WHERE name = ${input}`
  yield* Console.log(byName.compile())
  yield* Console.log(yield* byName)

  // The type parameter describes the rows. It is not checked at runtime; use
  // `SqlSchema` when you want the rows decoded and validated.
  const members = yield* sql<{ id: number; name: string }>`
    SELECT id, name FROM users WHERE role = ${'member'} ORDER BY id
  `
  yield* Console.log(members)

  // Helpers cover the cases a plain value cannot. `sql.in` expands a list,
  // and `sql(name)` quotes an identifier such as a column name.
  const sortColumn = 'name'
  const picked = yield* sql`
    SELECT name FROM users
    WHERE ${sql.in('id', [1, 3])}
    ORDER BY ${sql(sortColumn)} DESC
  `
  yield* Console.log(picked)

  // Statements and fragments compose. Build a `WHERE` clause from optional
  // filters with `sql.and`; with no filters it becomes `1=1`.
  const search = (filters: { role?: string; nameLike?: string }) => {
    const clauses: Array<Statement.Fragment> = []
    if (filters.role !== undefined) clauses.push(sql`role = ${filters.role}`)
    if (filters.nameLike !== undefined) {
      clauses.push(sql`name LIKE ${filters.nameLike}`)
    }
    return sql`SELECT name FROM users WHERE ${sql.and(clauses)} ORDER BY id`
  }
  yield* Console.log(search({ role: 'member', nameLike: 'G%' }).compile())
  yield* Console.log(yield* search({ role: 'member', nameLike: 'G%' }))
  yield* Console.log(search({}).compile()[0])
}).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' })))
