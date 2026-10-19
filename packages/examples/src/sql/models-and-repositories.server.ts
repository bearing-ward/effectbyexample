/**
 * @title Models and repositories
 * @difficulty intermediate
 * @summary A `Model.Class` declares a table's fields once and derives a
 * schema for each operation: selecting, inserting, updating, and JSON.
 * `SqlModel.makeRepository` turns a model into ready-made insert, update,
 * find, and delete queries.
 */

import { SqliteClient } from '@effect/sql-sqlite-node'
import { Console, Effect, Schema } from 'effect'
import { Model } from 'effect/schema'
import { SqlClient, SqlModel } from 'effect/sql'

// `Model.Field` says which variants contain a field. The database assigns
// the id, so it is missing from `insert`, but `update` needs it to find the
// row. (`Model.GeneratedByDb` would also drop it from `update`.)
// `Model.BooleanSqlite` stores a boolean as 0 or 1.
class Todo extends Model.Class<Todo>('Todo')({
  id: Model.Field({ select: Schema.Int, update: Schema.Int, json: Schema.Int }),
  title: Schema.NonEmptyString,
  done: Model.BooleanSqlite,
}) {}

export const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE todos (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      title TEXT NOT NULL,
      done INTEGER NOT NULL
    )
  `

  // Each variant is a schema with only the fields that operation needs.
  yield* Console.log(Object.keys(Todo.fields))
  yield* Console.log(Object.keys(Todo.insert.fields))

  // The repository covers the everyday queries. Each method encodes its
  // input with the matching variant and decodes the returned row into a
  // `Todo`.
  const todos = yield* SqlModel.makeRepository(Todo, {
    tableName: 'todos',
    spanPrefix: 'Todos',
    idColumn: 'id',
  })

  // `Todo.insert.make` builds a value for the insert variant, without an id.
  // The repository returns the row the database stored, id included.
  const milk = yield* todos.insert(
    Todo.insert.make({ title: 'Buy milk', done: false }),
  )
  yield* todos.insert(Todo.insert.make({ title: 'Call mum', done: false }))
  yield* Console.log(milk)

  // `update` takes the full update variant and writes every column.
  const updated = yield* todos.update(
    Todo.update.make({ id: milk.id, title: 'Buy oat milk', done: true }),
  )
  yield* Console.log(updated.title, updated.done)

  // `findById` fails with `NoSuchElementError` when the row is missing.
  yield* todos.delete(milk.id)
  const missing = yield* todos.findById(milk.id).pipe(Effect.flip)
  yield* Console.log(missing._tag)

  // The JSON variants are for API boundaries. Decoding a request body with
  // `Todo.jsonCreate` rejects an empty title before any query runs.
  const createFromJson = (body: unknown) =>
    Schema.decodeUnknownEffect(Todo.jsonCreate)(body).pipe(
      Effect.flatMap((input) => todos.insert(Todo.insert.make(input))),
    )
  yield* createFromJson({ title: 'Plan trip', done: false })
  const rejected = yield* createFromJson({ title: '', done: false }).pipe(
    Effect.flip,
  )
  yield* Console.log(rejected._tag)

  const rows = yield* sql<{
    title: string
  }>`SELECT title FROM todos ORDER BY id`
  yield* Console.log(rows.map((row) => row.title))
}).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' })))
