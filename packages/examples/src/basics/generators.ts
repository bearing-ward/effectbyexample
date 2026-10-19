/**
 * @title Writing effects with generators
 * @difficulty beginner
 * @summary `Effect.gen` lets you write effectful code top to bottom, like
 * `async`/`await`. `yield*` plays the role of `await`, and a failure stops
 * the generator the way a thrown exception would, but with a typed error.
 */

import { Console, Effect, Schema } from 'effect'

class OrderNotFound extends Schema.TaggedError<OrderNotFound>()(
  'OrderNotFound',
  { orderId: Schema.String },
) {}

class EmptyOrder extends Schema.TaggedError<EmptyOrder>()('EmptyOrder', {
  orderId: Schema.String,
}) {}

const orders = new Map([
  ['ord-1', [{ name: 'mug', cents: 1200, quantity: 2 }]],
  ['ord-2', []],
])

const findOrder = (orderId: string) => {
  const lines = orders.get(orderId)
  return lines === undefined
    ? Effect.fail(new OrderNotFound({ orderId }))
    : Effect.succeed(lines)
}

// Inside the generator, `yield*` runs an effect and gives you its success
// value. Ordinary `if`, loops, and local variables work as usual.
const orderTotal = (orderId: string) =>
  Effect.gen(function* () {
    const lines = yield* findOrder(orderId)

    // Errors created with `Schema.TaggedError` can be yielded directly. Write
    // `return yield*` so TypeScript knows the code after it does not run.
    if (lines.length === 0) {
      return yield* new EmptyOrder({ orderId })
    }

    let cents = 0
    for (const line of lines) {
      cents += line.cents * line.quantity
    }
    return cents
  })

// The inferred type collects every error the generator can fail with:
// `Effect<number, OrderNotFound | EmptyOrder>`.
const total: Effect.Effect<number, OrderNotFound | EmptyOrder> =
  orderTotal('ord-1')

export const program = Effect.gen(function* () {
  yield* Console.log('ord-1 total:', yield* total)

  // A failing `yield*` stops the generator, so later lines never run. We use
  // `Effect.flip` to look at the error instead of failing the program.
  for (const orderId of ['ord-2', 'ord-9']) {
    const error = yield* Effect.flip(orderTotal(orderId))
    yield* Console.log(`${orderId} failed with ${error._tag}`)
  }
})
