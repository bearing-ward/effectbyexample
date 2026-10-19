/**
 * @title Arrays, tuples, and records
 * @difficulty beginner
 * @summary Schemas for collections: arrays of any length, arrays that must
 * have at least one item, fixed length tuples, and records keyed by string.
 */

import { Console, Effect, Schema } from 'effect'

// `Schema.Array` validates every element with the inner schema.
const Scores = Schema.Array(Schema.Number)

// `NonEmptyArray` also requires at least one element, and its type,
// `readonly [number, ...number[]]`, lets you read the first item safely.
const Recipients = Schema.NonEmptyArray(Schema.String)

// `Tuple` fixes the length and gives each position its own schema.
const Coordinate = Schema.Tuple([Schema.Number, Schema.Number])

// `Record` validates both keys and values, here a lookup from a name to a
// count.
const Inventory = Schema.Record(Schema.String, Schema.Number)

export const program = Effect.gen(function* () {
  yield* Console.log(Schema.decodeUnknownSync(Scores)([90, 85, 77]))

  const recipients = Schema.decodeUnknownSync(Recipients)(['ada@example.com'])
  yield* Console.log(`first: ${recipients[0]}`)
  yield* Console.log(Schema.is(Recipients)([]))

  yield* Console.log(Schema.decodeUnknownSync(Coordinate)([40.7, -74]))
  yield* Console.log(Schema.is(Coordinate)([40.7]))

  yield* Console.log(
    Schema.decodeUnknownSync(Inventory)({ apples: 3, pears: 0 }),
  )
  yield* Console.log(Schema.is(Inventory)({ apples: 'three' }))
})
