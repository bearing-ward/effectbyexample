/**
 * @title Waiting for a condition with txRetry
 * @difficulty intermediate
 * @summary A transaction can say "not yet". `Effect.txRetry` abandons the
 * current attempt and sleeps until one of the `TxRef`s it read changes. There
 * is no polling loop and no lost wake-up.
 */

import { Console, Effect, Fiber, Ref, TxRef } from 'effect'

export const program = Effect.gen(function* () {
  const balance = yield* TxRef.make(20)
  // A plain `Ref` counts how many times the withdrawal has given up. The
  // example waits on it, so the output does not depend on timing.
  const parked = yield* Ref.make(0)
  const parkedAtLeast = (times: number) =>
    Ref.get(parked).pipe(Effect.repeat({ until: (n) => n >= times }))

  // The withdrawal needs 100. Until the balance covers it, the body calls
  // `Effect.txRetry`. The runtime discards the attempt, parks the fiber, and
  // reruns the body when `balance` is written by another transaction.
  const withdraw = Effect.tx(
    Effect.gen(function* () {
      // Side effects like logging are not rolled back, so they repeat on
      // every attempt. Here that is what we want to see.
      // `Effect.Transaction` describes the current attempt. `attempt` starts
      // at 1 and `retryReason` says why the body is running again.
      const meta = yield* Effect.Transaction
      const current = yield* TxRef.get(balance)
      yield* Console.log(
        `attempt ${meta.attempt} (${meta.retryReason ?? 'first run'}): balance ${current}`,
      )
      if (current < 100) {
        yield* Ref.update(parked, (n) => n + 1)
        return yield* Effect.txRetry
      }
      yield* TxRef.set(balance, current - 100)
      return current - 100
    }),
  )

  const fiber = yield* Effect.forkChild(withdraw)
  yield* parkedAtLeast(1)

  // Writing a value that still is not enough wakes the withdrawal, which
  // checks again and goes back to sleep.
  yield* TxRef.update(balance, (amount) => amount + 30)
  yield* parkedAtLeast(2)

  // This deposit is enough. The withdrawal wakes, succeeds, and commits.
  yield* TxRef.update(balance, (amount) => amount + 70)
  const left = yield* Fiber.join(fiber)
  yield* Console.log(`withdrew 100, ${left} left`)
})
