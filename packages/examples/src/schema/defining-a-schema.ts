/**
 * @title Defining a schema
 * @difficulty beginner
 * @summary A schema describes the shape of your data once. From that single
 * description you get a TypeScript type, a runtime validator, and a way to
 * turn untrusted input into trusted values.
 */

// Schema ships inside the core `effect` package. There is nothing else to
// install.
import { Console, Effect, Schema } from 'effect'

// `Schema.Struct` describes an object. Each field is itself a schema, so a
// struct is just schemas all the way down.
const Person = Schema.Struct({
  name: Schema.String,
  age: Schema.Number,
})

// The TypeScript type comes from the schema, so the two can never drift
// apart. Hover `Person` in your editor: `{ readonly name: string; readonly
// age: number }`.
type Person = typeof Person.Type

// Data from outside your program (a request body, a file, `JSON.parse`) is
// `unknown` until proven otherwise.
const input: unknown = { name: 'Ada', age: 36 }

export const program = Effect.gen(function* () {
  // `decodeUnknownSync` checks the input and returns a typed `Person`, or
  // throws if the input does not match.
  const ada: Person = Schema.decodeUnknownSync(Person)(input)
  yield* Console.log(ada)

  // `Schema.is` builds a type guard from the same schema, for when you only
  // need a yes or no answer.
  const isPerson = Schema.is(Person)
  yield* Console.log(isPerson({ name: 'Grace', age: 85 }))
  yield* Console.log(isPerson({ name: 'Grace' }))
})
