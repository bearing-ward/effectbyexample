/**
 * @title Handling SQL errors
 * @difficulty intermediate
 * @summary Every failed query fails with one `SqlError`. Its `reason` says
 * what went wrong, such as a unique or constraint violation, so you can turn
 * the cases your domain cares about into domain errors.
 */

import { SqliteClient } from '@effect/sql-sqlite-node'
import { Console, Effect, Schema } from 'effect'
import { SqlClient, SqlError } from 'effect/sql'

class EmailTaken extends Schema.TaggedError<EmailTaken>()('EmailTaken', {
  email: Schema.String,
}) {}

class InvalidAge extends Schema.TaggedError<InvalidAge>()('InvalidAge', {
  age: Schema.Int,
}) {}

export const program = Effect.gen(function* () {
  const sql = yield* SqlClient.SqlClient
  yield* sql`
    CREATE TABLE users (
      id INTEGER PRIMARY KEY,
      email TEXT NOT NULL UNIQUE,
      age INTEGER NOT NULL CHECK (age >= 13)
    )
  `

  // The driver classifies database errors into reasons. A duplicate value in
  // a `UNIQUE` column is a `UniqueViolation`, which also names the constraint.
  // SQLite reports a duplicate primary key differently, so it arrives as the
  // more general `ConstraintError`.
  yield* sql`INSERT INTO users ${sql.insert({ email: 'ada@example.com', age: 36 })}`
  const duplicate = yield* sql`INSERT INTO users ${sql.insert({
    email: 'ada@example.com',
    age: 36,
  })}`.pipe(Effect.flip)
  yield* Console.log(SqlError.isSqlError(duplicate), duplicate.reason._tag)
  if (duplicate.reason._tag === 'UniqueViolation') {
    yield* Console.log(duplicate.reason.constraint)
  }

  // Reasons also say whether retrying could help. A unique violation will
  // fail again, so it is not retryable. Deadlocks and lock timeouts are.
  yield* Console.log(duplicate.isRetryable)

  // `Effect.catchReasons` handles chosen reasons of a tagged error. Here the
  // two expected violations become domain errors. Any other reason stays a
  // `SqlError`, and the function's type says so.
  const register = (email: string, age: number) =>
    sql`INSERT INTO users ${sql.insert({ email, age })}`.pipe(
      Effect.asVoid,
      Effect.catchReasons('SqlError', {
        UniqueViolation: () => Effect.fail(new EmailTaken({ email })),
        ConstraintError: () => Effect.fail(new InvalidAge({ age })),
      }),
    )

  const attempts = [
    ['grace@example.com', 45],
    ['ada@example.com', 20],
    ['kid@example.com', 9],
  ] as const
  for (const [email, age] of attempts) {
    const outcome = yield* register(email, age).pipe(
      Effect.as('registered'),
      Effect.catchTags({
        EmailTaken: (error) => Effect.succeed(`taken: ${error.email}`),
        InvalidAge: (error) => Effect.succeed(`invalid age: ${error.age}`),
      }),
    )
    yield* Console.log(outcome)
  }

  // Errors the driver cannot classify, such as a syntax error under SQLite,
  // arrive as `UnknownError`. The original driver error is kept as `cause`.
  const typo = yield* sql`SELEC * FROM users`.pipe(Effect.flip)
  yield* Console.log(typo.reason._tag, typo.message)
}).pipe(Effect.provide(SqliteClient.layer({ filename: ':memory:' })))
