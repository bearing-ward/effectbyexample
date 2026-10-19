/**
 * @title MutableRef, and when not to use it
 * @difficulty beginner
 * @summary `MutableRef` is a plain synchronous box: reading and writing it
 * happens right away, not as an Effect. That makes it handy inside
 * callbacks and non-Effect code, and easy to misuse inside Effect code,
 * where a `Ref` is usually the better choice.
 */

import { Console, Effect, MutableRef, Ref } from 'effect'

export const program = Effect.gen(function* () {
  // A good fit: counting inside a synchronous callback that knows nothing
  // about Effect, such as an event listener or an array method.
  const clicks = MutableRef.make(0)
  const onClick = () => MutableRef.increment(clicks)
  const buttons = ['buy', 'buy', 'cancel']
  buttons.forEach(onClick)
  yield* Console.log('clicks:', MutableRef.get(clicks))

  // The trap: an Effect is a description that can run many times. Here the
  // increment happens once, while building the description, so every run
  // returns the same number.
  const counter = MutableRef.make(0)
  const eager = Effect.succeed(MutableRef.incrementAndGet(counter))
  const eagerRuns = [yield* eager, yield* eager, yield* eager]
  yield* Console.log('eager:', eagerRuns)

  // Wrapping the call in `Effect.sync` delays it until the effect runs.
  const lazy = Effect.sync(() => MutableRef.incrementAndGet(counter))
  const lazyRuns = [yield* lazy, yield* lazy, yield* lazy]
  yield* Console.log('lazy:', lazyRuns)

  // Inside Effect code, prefer `Ref`: every operation is already an
  // effect, so this trap cannot happen, and it works with the rest of the
  // toolkit, such as `SynchronizedRef` and `SubscriptionRef` when you need
  // effectful updates or to watch for changes. Neither `MutableRef` nor
  // `Ref` can wait for a value; use `Deferred` or a `Queue` for that.
  const orders = yield* Ref.make(0)
  const placeOrder = Ref.updateAndGet(orders, (n) => n + 1)
  yield* Console.log('ref:', [
    yield* placeOrder,
    yield* placeOrder,
    yield* placeOrder,
  ])
})
