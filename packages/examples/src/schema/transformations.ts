/**
 * @title Transformations
 * @difficulty intermediate
 * @summary A schema has two sides: the `Encoded` shape that travels over the
 * wire and the `Type` your code works with. Transformations convert between
 * them in both directions.
 */

import { Console, Effect, Schema, SchemaTransformation } from 'effect'

// `NumberFromString` decodes `"42"` into `42`, and encodes `42` back into
// `"42"`. Its `Encoded` type is `string` and its `Type` is `number`.
const Quantity = Schema.NumberFromString

// Query strings and form fields are always strings, so this is a common
// first transformation.
const SearchParams = Schema.Struct({
  page: Schema.NumberFromString,
  query: Schema.String,
})

// Build your own with `decodeTo`. Start from the encoded schema, name the
// type schema, and give a pair of functions. Here a comma separated string
// becomes an array of tags.
const Tags = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Array(Schema.String),
    SchemaTransformation.transform({
      decode: (text): ReadonlyArray<string> =>
        text.split(',').map((tag) => tag.trim()),
      encode: (tags) => tags.join(','),
    }),
  ),
)

export const program = Effect.gen(function* () {
  // Decoding goes from `Encoded` to `Type`.
  yield* Console.log(Schema.decodeUnknownSync(Quantity)('42') + 1)
  yield* Console.log(
    Schema.decodeUnknownSync(SearchParams)({ page: '2', query: 'effect' }),
  )

  // Encoding goes the other way, from `Type` back to `Encoded`.
  yield* Console.log(Schema.encodeSync(SearchParams)({ page: 3, query: 'ts' }))

  const tags = Schema.decodeUnknownSync(Tags)('effect, schema, typescript')
  yield* Console.log(tags)
  yield* Console.log(Schema.encodeSync(Tags)(tags))

  // Careful: `NumberFromString` follows JavaScript's `Number(...)`, so `"abc"`
  // decodes to `NaN`. Use `FiniteFromString` when only real numbers will do.
  yield* Console.log(Schema.decodeUnknownOption(Quantity)('abc'))
  yield* Console.log(Schema.decodeUnknownOption(Schema.FiniteFromString)('abc'))
})
