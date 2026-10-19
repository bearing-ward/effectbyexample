/**
 * @title Creating effects
 * @difficulty beginner
 * @summary Most effects start from a plain value, a function, or a promise.
 * Pick the constructor that matches what your code does: whether it can
 * throw, whether it is async, and whether failure is expected.
 */

import { Console, Effect, Schema } from 'effect'

class InvalidJson extends Schema.TaggedError<InvalidJson>()('InvalidJson', {
  input: Schema.String,
}) {}

class InventoryUnavailable extends Schema.TaggedError<InventoryUnavailable>()(
  'InventoryUnavailable',
  { sku: Schema.String },
) {}

// `succeed` wraps a value you already have.
const defaultQuantity = Effect.succeed(1)

// `sync` wraps code that runs synchronously and cannot throw. The function is
// called each time the effect runs, not when it is created.
const cart: Array<string> = ['mug', 'lamp']
const itemCount = Effect.sync(() => cart.length)

// `try` wraps synchronous code that may throw. `catch` turns the thrown value
// into a typed error, so the failure appears in the type:
// `Effect<unknown, InvalidJson>`.
const parseCart = (input: string) =>
  Effect.try({
    try: () => JSON.parse(input) as unknown,
    catch: () => new InvalidJson({ input }),
  })

// `tryPromise` does the same for a promise that may reject.
const fetchStock = (sku: string) =>
  Effect.tryPromise({
    try: () =>
      sku === 'mug'
        ? Promise.resolve(12)
        : Promise.reject(new Error('warehouse offline')),
    catch: () => new InventoryUnavailable({ sku }),
  })

// `promise` is for promises that never reject. If one does reject anyway,
// that is treated as a bug (a defect), not an error you are expected to handle.
const loadTaxRate = Effect.promise(() => Promise.resolve(0.2))

// `fail` creates an effect that fails with a typed error you choose.
const outOfStock = Effect.fail(new InventoryUnavailable({ sku: 'lamp' }))

export const program = Effect.gen(function* () {
  yield* Console.log('quantity:', yield* defaultQuantity)
  yield* Console.log('items:', yield* itemCount)
  yield* Console.log('cart:', yield* parseCart('{"items":["mug"]}'))
  yield* Console.log('mug stock:', yield* fetchStock('mug'))
  yield* Console.log('tax rate:', yield* loadTaxRate)

  // Failures are values too. `Effect.flip` swaps the error into the success
  // channel so we can print them here without stopping the program.
  const badJson = yield* Effect.flip(parseCart('{oops'))
  yield* Console.log(badJson._tag, badJson.input)

  const offline = yield* Effect.flip(fetchStock('chair'))
  yield* Console.log(offline._tag, offline.sku)

  const lamp = yield* Effect.flip(outOfStock)
  yield* Console.log(lamp._tag, lamp.sku)
})
