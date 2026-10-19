/**
 * @title Failures from concurrent work
 * @difficulty intermediate
 * @summary When concurrent tasks fail, the first failure normally interrupts
 * the rest and you see one error. If the other tasks cannot be interrupted,
 * they finish and fail too, and the `Cause` keeps every one of those failures.
 */

import { Cause, Console, Effect, Exit, Schema } from 'effect'

class RefundFailed extends Schema.TaggedError<RefundFailed>()('RefundFailed', {
  orderId: Schema.String,
}) {}

// Each refund yields once before failing, so all of them have started by the
// time the first one fails.
const refund = (orderId: string) =>
  Effect.yieldNow.pipe(
    Effect.andThen(Effect.fail(new RefundFailed({ orderId }))),
  )

const orderIds = ['ord-1', 'ord-2', 'ord-3']

// Collects the order ids of every `Fail` reason in a cause.
const failedOrders = (exit: Exit.Exit<unknown, RefundFailed>) =>
  Exit.isFailure(exit)
    ? exit.cause.reasons
        .filter(Cause.isFailReason)
        .map((reason) => reason.error.orderId)
    : []

export const program = Effect.gen(function* () {
  // By default the first failure interrupts the other refunds, so the cause
  // holds a single failure.
  const fastFail = yield* Effect.exit(
    Effect.forEach(orderIds, refund, { concurrency: 'unbounded' }),
  )
  yield* Console.log('interruptible:', failedOrders(fastFail))

  // A refund that has started talking to the bank should not be cut off
  // halfway. `Effect.uninterruptible` lets each one run to the end, so all
  // three fail, and all three failures are kept.
  const allFail = yield* Effect.exit(
    Effect.forEach(
      orderIds,
      (orderId) => Effect.uninterruptible(refund(orderId)),
      {
        concurrency: 'unbounded',
      },
    ),
  )
  yield* Console.log('uninterruptible:', failedOrders(allFail))

  // `Effect.catch` and friends see only the first error. When you need all of
  // them, handle the whole cause with `Effect.catchCause`.
  const report = yield* Effect.forEach(
    orderIds,
    (orderId) => Effect.uninterruptible(refund(orderId)),
    { concurrency: 'unbounded' },
  ).pipe(
    Effect.as('all refunded'),
    Effect.catchCause((cause) =>
      Effect.succeed(`${cause.reasons.length} refunds need a manual retry`),
    ),
  )
  yield* Console.log(report)

  // If you would rather collect every outcome than fail, ask for results
  // instead: `mode: 'result'` gives one `Result` per task.
  const results = yield* Effect.all(orderIds.map(refund), {
    concurrency: 'unbounded',
    mode: 'result',
  })
  yield* Console.log(
    'results:',
    results.map((result) => result._tag),
  )
})
