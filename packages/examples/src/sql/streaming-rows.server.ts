/**
 * @title Streaming rows
 * @difficulty intermediate
 * @summary A large table should not be loaded into memory at once. Read it
 * as a `Stream` of rows instead, fetched page by page, so the program holds
 * one page at a time and stops querying as soon as it has what it needs.
 */

import { SqliteClient } from '@effect/sql-sqlite-node'
import { Console, Effect, Option, Stream } from 'effect'
import { SqlClient } from 'effect/sql'

interface Order {
  readonly id: number
  readonly totalCents: number
}

export const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE orders (id INTEGER PRIMARY KEY, total_cents INTEGER NOT NULL)`
  yield* sql`INSERT INTO orders ${sql.insert(
    Array.from({ length: 10 }, (_, i) => ({ total_cents: (i + 1) * 500 })),
  )}`

  // Keyset pagination: each page starts after the last id of the previous
  // one. Unlike `OFFSET`, the database can jump straight to the next page.
  const pageSize = 4
  const pageAfter = (afterId: number) =>
    Console.log(`fetching orders after id ${afterId}`).pipe(
      Effect.andThen(sql<Order>`
        SELECT id, total_cents AS totalCents FROM orders
        WHERE id > ${afterId} ORDER BY id LIMIT ${pageSize}
      `),
    )

  // `Stream.paginate` calls the function with the current cursor and emits
  // the rows it returns. `Option.none()` means there is no next page.
  const orders = Stream.paginate(0, (afterId: number) =>
    Effect.map(pageAfter(afterId), (rows) => {
      const last = rows.at(-1)
      return [
        rows,
        rows.length < pageSize || last === undefined
          ? Option.none()
          : Option.some(last.id),
      ] as const
    }),
  )

  // Streams are lazy. Taking three rows fetches only the first page.
  const firstThree = yield* orders.pipe(Stream.take(3), Stream.runCollect)
  yield* Console.log(firstThree.map((order) => order.id))

  // Running the whole stream walks every page while keeping one in memory.
  const totalCents = yield* orders.pipe(
    Stream.runFold(
      () => 0,
      (sum, order) => sum + order.totalCents,
    ),
  )
  yield* Console.log(`total: ${totalCents / 100}`)

  // Some drivers can also stream a single query with `statement.stream`, for
  // example the in-memory client of `@effect/sql-sqlite-wasm`. The
  // `node:sqlite` driver does not implement it, so here it dies instead.
  // Pagination works with every driver.
  const cursor = yield* sql`SELECT id FROM orders`.stream.pipe(
    Stream.runCollect,
    Effect.as('streamed'),
    Effect.catchDefect(() => Effect.succeed('not supported by this driver')),
  )
  yield* Console.log(cursor)
}).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' })))
