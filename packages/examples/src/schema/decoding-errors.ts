/**
 * @title Handling decoding errors
 * @difficulty beginner
 * @summary Decoding untrusted input can fail. Instead of a thrown exception,
 * the Effect API gives you a typed `SchemaError` that you handle like any
 * other failure.
 */

import { Console, Effect, Schema } from 'effect'

const Person = Schema.Struct({
  name: Schema.String,
  age: Schema.Number,
})

// `decodeUnknownEffect` returns an Effect that succeeds with a `Person` or
// fails with a `SchemaError`. The failure shows up in the type:
// `Effect<Person, SchemaError>`.
const decodePerson = Schema.decodeUnknownEffect(Person)

export const program = Effect.gen(function* () {
  // Good input decodes as usual.
  const ada = yield* decodePerson({ name: 'Ada', age: 36 })
  yield* Console.log(ada)

  // Bad input fails. `catchTag` handles the `SchemaError` and gives us its
  // human readable message, which points at the offending field.
  const message = yield* decodePerson({ name: 'Ada', age: '36' }).pipe(
    Effect.as('decoded'),
    Effect.catchTag('SchemaError', (error) => Effect.succeed(error.message)),
  )
  yield* Console.log(message)

  // By default decoding stops at the first problem. Pass `errors: 'all'` to
  // collect every problem at once, which is what you want for form feedback.
  const everything = yield* Schema.decodeUnknownEffect(Person)(
    { name: 1, age: 'old' },
    { errors: 'all' },
  ).pipe(
    Effect.as('decoded'),
    Effect.catchTag('SchemaError', (error) => Effect.succeed(error.message)),
  )
  yield* Console.log(everything)
})
