/**
 * @title Functions that return effects
 * @difficulty beginner
 * @summary `Effect.fn` turns a generator into a reusable function that returns
 * an Effect. Give it a name and every call gets a tracing span and a better
 * stack trace. `Effect.fnUntraced` is the same without the tracing.
 */

import { Console, Effect, Option, Schema } from 'effect'

class InvalidQuantity extends Schema.TaggedError<InvalidQuantity>()(
  'InvalidQuantity',
  { quantity: Schema.Number },
) {}

// A small helper that reports the name of the span we are running in.
const spanName = Effect.currentSpan.pipe(
  Effect.map((span) => span.name),
  Effect.option,
  Effect.map(Option.getOrElse(() => 'no span')),
)

// `Effect.fnUntraced` is for small helpers where a span would only add noise.
// `Effect.fn.Return<A, E>` states the result type, like `Effect<A, E>`.
const validateQuantity = Effect.fnUntraced(function* (
  quantity: number,
): Effect.fn.Return<number, InvalidQuantity> {
  yield* Console.log(`  validating inside: ${yield* spanName}`)
  if (!Number.isInteger(quantity) || quantity <= 0) {
    return yield* new InvalidQuantity({ quantity })
  }
  return quantity
})

// `Effect.fn('name')` wraps each call in a span with that name. Name it after
// the function so traces and stack traces point back here.
const addToCart = Effect.fn('addToCart')(
  function* (sku: string, quantity: number) {
    const valid = yield* validateQuantity(quantity)
    return `added ${valid} x ${sku}`
  },
  // Extra arguments are applied to the effect each call returns, in order.
  // Use them instead of `.pipe` on the function.
  Effect.catchTag('InvalidQuantity', (error) =>
    Effect.succeed(`rejected quantity ${error.quantity}`),
  ),
)

export const program = Effect.gen(function* () {
  // Calling the function only builds an effect. `yield*` runs it. The helper
  // runs inside the `addToCart` span.
  yield* Console.log(yield* addToCart('mug', 2))
  yield* Console.log(yield* addToCart('mug', 0))

  // Called on its own, the untraced helper has no span: it never creates one.
  yield* Console.log(yield* validateQuantity(3))
})
