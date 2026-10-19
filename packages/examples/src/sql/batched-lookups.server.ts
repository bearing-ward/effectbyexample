/**
 * @title Batched lookups
 * @difficulty advanced
 * @summary Looking up rows one at a time sends one query per row, the
 * classic N+1 problem. `SqlResolver` collects lookups made at the same time
 * and answers them with a single query, while each caller still asks for one
 * row.
 */

import { SqliteClient } from '@effect/sql-sqlite-node'
import { Console, Effect, Schema } from 'effect'
import { SqlClient, SqlResolver } from 'effect/sql'

class Author extends Schema.Class<Author>('Author')({
  id: Schema.Int,
  name: Schema.String,
}) {}

export const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`CREATE TABLE authors (id INTEGER PRIMARY KEY, name TEXT NOT NULL)`
  yield* sql`INSERT INTO authors ${sql.insert([
    { id: 1, name: 'Ursula K. Le Guin' },
    { id: 2, name: 'Octavia E. Butler' },
    { id: 3, name: 'Terry Pratchett' },
  ])}`

  // `findById` receives every id requested in the same batch and runs one
  // query for all of them. `ResultId` tells it which row answers which id.
  // The log line shows each query the resolver sends.
  const AuthorById = SqlResolver.findById({
    Id: Schema.Int,
    Result: Author,
    ResultId: (author) => author.id,
    execute: (ids) =>
      Console.log(`query for ids ${ids.join(', ')}`).pipe(
        Effect.andThen(sql`SELECT * FROM authors WHERE ${sql.in('id', ids)}`),
      ),
  })

  // Callers ask for one author at a time and never see the batching.
  const getAuthor = SqlResolver.request(AuthorById)

  // Books reference authors. Looking up each book's author concurrently lets
  // the requests meet in one batch. The duplicate id 1 is asked for once.
  const books = [
    { title: 'A Wizard of Earthsea', authorId: 1 },
    { title: 'Kindred', authorId: 2 },
    { title: 'The Dispossessed', authorId: 1 },
    { title: 'Mort', authorId: 3 },
  ]
  const withAuthors = yield* Effect.forEach(
    books,
    (book) =>
      getAuthor(book.authorId).pipe(
        Effect.map((author) => `${book.title} by ${author.name}`),
      ),
    { concurrency: 'unbounded' },
  )
  yield* Console.log(withAuthors)

  // An id with no row fails only its own request, with `NoSuchElementError`.
  // The other lookups in the batch still succeed.
  const results = yield* Effect.forEach(
    [3, 42],
    (id) =>
      getAuthor(id).pipe(
        Effect.map((author) => author.name),
        Effect.catchTag('NoSuchElementError', () =>
          Effect.succeed(`no author ${id}`),
        ),
      ),
    { concurrency: 'unbounded' },
  )
  yield* Console.log(results)
}).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' })))
