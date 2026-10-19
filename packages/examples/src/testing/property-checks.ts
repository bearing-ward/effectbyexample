/**
 * @title Property-based checks
 * @difficulty advanced
 * @summary Instead of picking test inputs by hand, state a rule that should
 * hold for every input and let `Arbitrary.checkEffect` hunt for a
 * counterexample. When it finds one, it shrinks it to a small, readable case.
 */

import { Arbitrary, Console, Effect, Schema } from 'effect'

const LineItem = Schema.Struct({
  cents: Schema.Int.check(Schema.isBetween({ minimum: 0, maximum: 5_000 })),
})
const Cart = Schema.Struct({
  items: Schema.Array(LineItem),
  couponCents: Schema.Int.check(
    Schema.isBetween({ minimum: 0, maximum: 2_000 }),
  ),
})
type Cart = typeof Cart.Type

const subtotal = (cart: Cart) =>
  cart.items.reduce((sum, item) => sum + item.cents, 0)

// Two implementations of the checkout total. The first forgets that a coupon
// can be worth more than the cart.
const buggyTotal = (cart: Cart) => subtotal(cart) - cart.couponCents
const fixedTotal = (cart: Cart) =>
  Math.max(0, subtotal(cart) - cart.couponCents)

const carts = Arbitrary.schema(Cart)

// The rule: a total is never negative. A property returns `true` when the
// rule holds. It may also return an Effect, so it can call your services.
const neverNegative = (total: (cart: Cart) => number) => (cart: Cart) =>
  total(cart) >= 0

export const program = Effect.gen(function* () {
  // The fixed version passes every generated cart. A fixed `seed` keeps the
  // run reproducible; `runs` sets how many carts to try.
  const passed = yield* Arbitrary.checkEffect(
    carts,
    neverNegative(fixedTotal),
    { seed: 2025, runs: 200 },
  )
  yield* Console.log(passed)

  // The buggy version fails. `initialInput` is the first failing cart found;
  // `shrunkInput` is the simpler cart that shrinking reduced it to.
  const failed = yield* Arbitrary.checkEffect(
    carts,
    neverNegative(buggyTotal),
    { seed: 2025, runs: 200 },
  )
  if (failed._tag === 'Falsified') {
    yield* Console.log('first failure:', failed.initialInput)
    yield* Console.log('shrunk to:', failed.shrunkInput)

    // A `replay` token reruns exactly that failure, so you can paste it into
    // a test while you fix the bug.
    const replayed = yield* Arbitrary.checkEffect(
      carts,
      neverNegative(buggyTotal),
      { replay: failed.replay },
    )
    yield* Console.log('replayed:', replayed._tag)
  }

  // `formatCheckFailure` turns a result into a test-runner style message.
  yield* Console.log(Arbitrary.formatCheckFailure(failed))
})
