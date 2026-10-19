/**
 * @title pipe and flow
 * @difficulty beginner
 * @summary Effect code reads left to right. `pipe` passes a value through a
 * list of functions, `flow` glues functions into a new one, and every Effect
 * has a `.pipe` method for adding behaviour step by step.
 */

import { Console, Effect, flow, Function, pipe } from 'effect'

const applyDiscount = (percent: number) => (cents: number) =>
  Math.round(cents * (1 - percent / 100))
const addShipping = (cents: number) => cents + 499
const formatPrice = (cents: number) => `$${(cents / 100).toFixed(2)}`

export const program = Effect.gen(function* () {
  // Without `pipe`, the steps nest and read inside out.
  yield* Console.log(formatPrice(addShipping(applyDiscount(10)(4000))))

  // `pipe(value, f, g, h)` is `h(g(f(value)))`, written in the order the
  // steps happen.
  yield* Console.log(pipe(4000, applyDiscount(10), addShipping, formatPrice))

  // `flow(f, g, h)` makes a reusable function out of the same steps, with no
  // starting value yet.
  const checkoutPrice = flow(applyDiscount(10), addShipping, formatPrice)
  yield* Console.log(checkoutPrice(2500))

  // Everything is also on the `Function` module. `identity` returns its
  // argument unchanged, which is handy as a "do nothing" step.
  const noDiscount = Function.identity<number>
  yield* Console.log(pipe(4000, noDiscount, addShipping, formatPrice))

  // Effects use the same idea. `Effect.map` and friends return functions that
  // take an effect, so you chain them with `.pipe`. Each step returns a new
  // effect; the original is untouched.
  const price = Effect.succeed(4000).pipe(
    Effect.map(applyDiscount(10)),
    Effect.tap((cents) => Console.log('after discount:', cents)),
    Effect.map(flow(addShipping, formatPrice)),
  )
  yield* Console.log('charged:', yield* price)
})
