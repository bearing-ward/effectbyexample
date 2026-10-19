/**
 * @title Running effects
 * @difficulty beginner
 * @summary An effect does nothing until a runner executes it. Choose the
 * runner that fits the caller: a promise, a synchronous value, an `Exit`, or
 * a fiber. Run once, at the edge of your program, and keep everything else as
 * effects.
 */

import { Console, Effect, Exit, Fiber, Schema } from 'effect'

class PaymentDeclined extends Schema.TaggedError<PaymentDeclined>()(
  'PaymentDeclined',
  { orderId: Schema.String },
) {}

const priceOrder = (orderId: string) => Effect.succeed({ orderId, cents: 2400 })

const chargeOrder = (orderId: string) =>
  orderId === 'ord-2'
    ? Effect.fail(new PaymentDeclined({ orderId }))
    : Effect.succeed(`charged ${orderId}`).pipe(Effect.delay('1 millis'))

// In a real app these calls sit at the edge, in a `main` function, a route
// handler, or a test. We call them inside the program here so the page can
// show what each one returns.
export const program = Effect.gen(function* () {
  // `runSync` runs a synchronous effect and returns its value directly.
  yield* Console.log(Effect.runSync(priceOrder('ord-1')))

  // It cannot wait. Given an effect that needs to wait, it throws instead.
  const syncError = yield* Effect.sync(() => {
    try {
      return String(Effect.runSync(chargeOrder('ord-1')))
    } catch (error) {
      return String(error)
    }
  })
  yield* Console.log(syncError)

  // `runPromise` returns a promise for code that speaks `async`/`await`. A
  // typed failure becomes a rejection with the error as the reason.
  const charged = yield* Effect.promise(() =>
    Effect.runPromise(chargeOrder('ord-1')),
  )
  yield* Console.log(charged)

  const rejected = yield* Effect.promise(() =>
    Effect.runPromise(chargeOrder('ord-2')).catch(
      (error) => `rejected: ${error._tag}`,
    ),
  )
  yield* Console.log(rejected)

  // `runPromiseExit` never rejects. It resolves with an `Exit`, a value that
  // is either a success or a failure, so nothing gets lost in a `catch`.
  const exit = yield* Effect.promise(() =>
    Effect.runPromiseExit(chargeOrder('ord-2')),
  )
  yield* Console.log('exit is failure:', Exit.isFailure(exit))

  // `runFork` starts the effect in the background and returns a `Fiber`, a
  // handle you can wait on or interrupt later.
  const fiber = Effect.runFork(chargeOrder('ord-3'))
  yield* Console.log('fiber result:', yield* Fiber.join(fiber))

  // Inside an effect you rarely need a runner: `yield*` already runs things.
  // Calling `runPromise` deep inside your code starts a separate run that
  // does not share interruption or services with its caller. That is why you
  // run once, at the edge.
  yield* Console.log(yield* chargeOrder('ord-4'))
})
