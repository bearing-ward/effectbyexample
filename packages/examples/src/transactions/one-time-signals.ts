/**
 * @title One-time signals with TxDeferred
 * @difficulty intermediate
 * @summary A `TxDeferred` is a write-once cell. Awaiting it inside a
 * transaction retries until someone completes it, so "wait for the signal,
 * then claim a unit of stock" can be a single atomic step.
 */

import { Console, Effect, Fiber, Option, TxDeferred, TxRef } from 'effect'

export const program = Effect.gen(function* () {
  // The launch either succeeds with a price or fails with a reason.
  const launch = yield* TxDeferred.make<number, string>()
  const unitsLeft = yield* TxRef.make(2)

  // A buyer waits for the launch and claims a unit in one transaction.
  // `TxDeferred.await` retries while the cell is empty, and fails with the
  // typed error if the launch was cancelled.
  const buy = (buyer: string) =>
    Effect.tx(
      Effect.gen(function* () {
        const price = yield* TxDeferred.await(launch)
        const units = yield* TxRef.get(unitsLeft)
        if (units === 0) {
          return `${buyer}: sold out`
        }
        yield* TxRef.set(unitsLeft, units - 1)
        return `${buyer}: bought at $${price}`
      }),
    )

  const buyers = yield* Effect.forkChild(
    Effect.forEach(['ana', 'ben', 'cleo'], buy, { concurrency: 'unbounded' }),
  )

  // `poll` peeks without waiting. `none` means nobody has completed it yet.
  yield* Console.log(
    `before launch: ${Option.isNone(yield* TxDeferred.poll(launch))}`,
  )

  // The first completion wins and returns `true`. Later attempts return
  // `false` and change nothing, which makes the signal safe to send twice.
  yield* Console.log(`first: ${yield* TxDeferred.succeed(launch, 25)}`)
  yield* Console.log(`second: ${yield* TxDeferred.succeed(launch, 99)}`)

  // Each buyer saw the same price, and only two of them got a unit.
  for (const line of yield* Fiber.join(buyers)) {
    yield* Console.log(line)
  }

  // A deferred completed with `fail` delivers the error to every waiter.
  const recall = yield* TxDeferred.make<number, string>()
  yield* TxDeferred.fail(recall, 'recalled by the supplier')
  const error = yield* TxDeferred.await(recall).pipe(Effect.flip)
  yield* Console.log(`recall: ${error}`)
})
