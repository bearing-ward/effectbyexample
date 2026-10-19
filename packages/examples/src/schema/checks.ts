/**
 * @title Checks and refinements
 * @difficulty beginner
 * @summary Types say "a string". Checks say "a non-empty string under 20
 * characters". Attach checks to any schema to tighten what it accepts.
 */

import { Console, Effect, Schema } from 'effect'

// `.check(...)` adds one or more constraints. Effect ships common ones like
// `isMinLength`, `isMaxLength`, `isPattern`, `isGreaterThan`, and `isInt`.
const Username = Schema.String.check(
  Schema.isMinLength(3),
  Schema.isMaxLength(20),
  Schema.isPattern(/^[a-z0-9_]+$/),
)

const Age = Schema.Number.check(
  Schema.isInt(),
  Schema.isBetween({ minimum: 0, maximum: 150 }),
)

// Write your own with `makeFilter`. Return `true` to accept, or a message
// explaining why the value was rejected.
const isEven = Schema.makeFilter((n: number) =>
  n % 2 === 0 ? true : `expected an even number, got ${n}`,
)
const EvenNumber = Schema.Number.check(isEven)

const describe = <S extends Schema.Codec<unknown>>(schema: S, input: unknown) =>
  Schema.decodeUnknownEffect(schema)(input).pipe(
    Effect.as('ok'),
    Effect.catchTag('SchemaError', (error) => Effect.succeed(error.message)),
  )

export const program = Effect.gen(function* () {
  yield* Console.log(yield* describe(Username, 'ada_lovelace'))
  yield* Console.log(yield* describe(Username, 'Ada!'))
  yield* Console.log(yield* describe(Age, 36.5))
  yield* Console.log(yield* describe(EvenNumber, 7))

  // Checks do not change the type. `Username` is still `string`; see the
  // branded types example to make the type remember the check.
  yield* Console.log(Schema.is(Username)('grace'))
})
