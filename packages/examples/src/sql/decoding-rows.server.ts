/**
 * @title Decoding rows with schemas
 * @difficulty intermediate
 * @summary The database is a boundary, like an HTTP request. `SqlSchema`
 * pairs a query with a request schema and a result schema, so parameters are
 * encoded on the way in and every row is decoded and checked on the way out.
 */

import { SqliteClient } from '@effect/sql-sqlite-node'
import { Console, Effect, Schema, String } from 'effect'
import { SqlClient, SqlSchema } from 'effect/sql'

// The shape the rest of the program works with. SQLite has no boolean type,
// so `inStock` is stored as 0 or 1 and `BooleanFromBit` decodes it.
class Product extends Schema.Class<Product>('Product')({
  id: Schema.Int,
  name: Schema.String,
  priceCents: Schema.Int,
  inStock: Schema.BooleanFromBit,
}) {}

export const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient

  yield* sql`
    CREATE TABLE products (
      id INTEGER PRIMARY KEY,
      name TEXT NOT NULL,
      price_cents INTEGER,
      in_stock INTEGER NOT NULL
    )
  `
  yield* sql`INSERT INTO products ${sql.insert([
    { name: 'Kettle', priceCents: 2500, inStock: 1 },
    { name: 'Teapot', priceCents: 1800, inStock: 0 },
    { name: 'Mug', priceCents: 900, inStock: 1 },
  ])}`

  // `findAll` decodes every row. `Request` describes the input, and `execute`
  // receives it in its encoded form.
  const cheaperThan = SqlSchema.findAll({
    Request: Schema.Struct({ maxCents: Schema.Int }),
    Result: Product,
    execute: ({ maxCents }) =>
      sql`SELECT * FROM products WHERE price_cents < ${maxCents} ORDER BY id`,
  })
  const cheap = yield* cheaperThan({ maxCents: 2000 })
  yield* Console.log(cheap.map((product) => [product.name, product.inStock]))
  yield* Console.log(cheap[0] instanceof Product)

  // `findOneOption` returns the first row as an `Option`. `findOne` fails
  // with `NoSuchElementError` instead when there is no row.
  const byId = SqlSchema.findOneOption({
    Request: Schema.Int,
    Result: Product,
    execute: (id) => sql`SELECT * FROM products WHERE id = ${id}`,
  })
  yield* Console.log(yield* byId(3))
  yield* Console.log(yield* byId(99))

  // When a row does not match the schema, the query fails with a
  // `SchemaError` instead of handing bad data to the rest of the program.
  // The message points at the row and field: index 3, `priceCents`.
  yield* sql`INSERT INTO products ${sql.insert({
    name: 'Mystery box',
    priceCents: null,
    inStock: 1,
  })}`
  const everything = SqlSchema.findAll({
    Request: Schema.Void,
    Result: Product,
    execute: () => sql`SELECT * FROM products ORDER BY id`,
  })
  const failure = yield* everything().pipe(Effect.flip)
  yield* Console.log(failure._tag)
  yield* Console.log(failure.message)
}).pipe(
  // Column names are snake_case in SQL and camelCase in TypeScript. The
  // client converts both ways: `price_cents` comes back as `priceCents`, and
  // `sql.insert({ priceCents })` writes the `price_cents` column.
  Effect.provide(
    SqliteClient.layer({
      filename: ':memory:',
      transformResultNames: String.snakeToCamel,
      transformQueryNames: String.camelToSnake,
    }),
  ),
)
