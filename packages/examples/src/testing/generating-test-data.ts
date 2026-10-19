/**
 * @title Generating test data from schemas
 * @difficulty intermediate
 * @summary You already describe valid data with a schema. `Arbitrary` turns
 * that schema into a generator of random values that pass it, checks and
 * patterns included. Fix the seed and the "random" data is the same every run.
 */

import { Arbitrary, Console, Effect, Schema } from 'effect'

// Effect 4 ships its own generator, so there is no `fast-check` to install.
// The `Arbitrary` module is marked unstable.
const Order = Schema.Struct({
  id: Schema.String.check(Schema.isPattern(/^ord_[a-z0-9]{4}$/)),
  quantity: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  status: Schema.Literals(['pending', 'paid', 'shipped']),
  giftNote: Schema.optionalKey(Schema.String.check(Schema.isMaxLength(12))),
})

export const program = Effect.gen(function* () {
  // `Arbitrary.schema` derives a generator from the decoded type of a
  // schema. Every value respects the pattern, the integer range, the
  // literals, and the optional key.
  const orders = Arbitrary.schema(Order)

  // `sampleEffect` draws values. `seed` makes the draw repeatable; `size`
  // keeps strings and collections small.
  const sample = yield* Arbitrary.sampleEffect(orders, {
    count: 3,
    seed: 42,
    size: 5,
  })
  yield* Console.log(sample)
  yield* Console.log(sample.every(Schema.is(Order)))

  // Arbitraries compose. `array` builds lists from an element generator, and
  // `map` derives new values, here a cart summary.
  const carts = Arbitrary.array(orders, { minLength: 1, maxLength: 4 }).pipe(
    Arbitrary.map((items) => ({
      items: items.length,
      units: items.reduce((sum, item) => sum + item.quantity, 0),
    })),
  )
  yield* Console.log(
    yield* Arbitrary.sampleEffect(carts, { count: 4, seed: 'carts', size: 5 }),
  )
})
