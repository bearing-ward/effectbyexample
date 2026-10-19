/**
 * @title Shared state with Ref and SynchronizedRef
 * @difficulty intermediate
 * @summary A `Ref` is a mutable cell that many fibers can update safely,
 * as long as each change is a single `update` or `modify`. When the change
 * itself needs to run an effect, `SynchronizedRef` runs those updates one
 * at a time.
 */

import { Console, Effect, Ref, SynchronizedRef } from 'effect'

const hundred = Array.from({ length: 100 }, (_, i) => i)

export const program = Effect.gen(function* () {
  // `Ref.update` applies a pure function in one step. A hundred fibers
  // adding to the same counter never lose an update.
  const views = yield* Ref.make(0)
  yield* Effect.forEach(hundred, () => Ref.update(views, (n) => n + 1), {
    concurrency: 'unbounded',
  })
  yield* Console.log('views with update:', yield* Ref.get(views))

  // Reading, doing other work, then writing is not one step. Other fibers
  // run in between and their writes are overwritten.
  const racy = yield* Ref.make(0)
  yield* Effect.forEach(
    hundred,
    () =>
      Effect.gen(function* () {
        const current = yield* Ref.get(racy)
        yield* Effect.yieldNow
        yield* Ref.set(racy, current + 1)
      }),
    { concurrency: 'unbounded' },
  )
  yield* Console.log('views with get then set:', yield* Ref.get(racy))

  // `Ref.modify` updates and returns a result in the same step, such as
  // handing out unique ticket numbers.
  const nextTicket = yield* Ref.make(1)
  const tickets = yield* Effect.forEach(
    [1, 2, 3],
    () => Ref.modify(nextTicket, (n) => [`T-${n}`, n + 1] as const),
    { concurrency: 'unbounded' },
  )
  yield* Console.log('tickets:', tickets)

  // A `Ref` update must be pure. When computing the new value needs an
  // effect, such as asking a service for exchange rates, use
  // `SynchronizedRef`. Its effectful updates queue up and run one at a
  // time, so each sees the result of the previous one.
  const balance = yield* SynchronizedRef.make(100)
  const running = yield* Ref.make(0)
  const peak = yield* Ref.make(0)

  const deposit = (amount: number) =>
    SynchronizedRef.updateEffect(balance, (current) =>
      Effect.gen(function* () {
        const now = yield* Ref.updateAndGet(running, (n) => n + 1)
        yield* Ref.update(peak, (most) => Math.max(most, now))
        yield* Effect.yieldNow
        yield* Ref.update(running, (n) => n - 1)
        return current + amount
      }),
    )

  yield* Effect.forEach([10, 20, 30, 40], deposit, { concurrency: 'unbounded' })
  yield* Console.log('balance:', yield* SynchronizedRef.get(balance))
  yield* Console.log('updates running at once:', yield* Ref.get(peak))
})
