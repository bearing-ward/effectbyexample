/**
 * @title Broadcasting with TxPubSub and TxSubscriptionRef
 * @difficulty advanced
 * @summary `TxPubSub` delivers each published message to every subscriber,
 * and `TxSubscriptionRef` is a value that tells subscribers when it changes.
 * Both publish only when the surrounding transaction commits, so a rolled
 * back update never leaks out as an event.
 */

import {
  Console,
  Effect,
  Schema,
  TxPubSub,
  TxQueue,
  TxSubscriptionRef,
} from 'effect'

class PaymentDeclined extends Schema.TaggedError<PaymentDeclined>()(
  'PaymentDeclined',
  {},
) {}

type Status = 'cart' | 'paid' | 'shipped'

export const program = Effect.gen(function* () {
  // The order status is a `TxSubscriptionRef`. The event bus is a `TxPubSub`.
  const status = yield* TxSubscriptionRef.make<Status>('cart')
  const events = yield* TxPubSub.unbounded<string>()

  // Subscriptions live in a `Scope` and end when it closes. Each one is a
  // `TxQueue` of its own. `TxPubSub.subscribe` and `TxSubscriptionRef.changes`
  // are marked unstable in Effect 4.0.5.
  yield* Effect.scoped(
    Effect.gen(function* () {
      const email = yield* TxPubSub.subscribe(events)
      const analytics = yield* TxPubSub.subscribe(events)
      // A `changes` subscriber first receives the current value.
      const statusFeed = yield* TxSubscriptionRef.changes(status)

      // Moving the order forward updates the status and publishes an event
      // in one transaction.
      const advance = (next: Status, fail: boolean) =>
        Effect.tx(
          Effect.gen(function* () {
            yield* TxSubscriptionRef.set(status, next)
            yield* TxPubSub.publish(events, `order is ${next}`)
            if (fail) {
              return yield* new PaymentDeclined()
            }
          }),
        )

      yield* advance('paid', false)

      // This attempt sets the status and publishes, then fails. The whole
      // transaction rolls back: no status change and no event.
      yield* advance('shipped', true).pipe(Effect.ignore)

      yield* advance('shipped', false)

      // `TxQueue.takeAll` drains everything a subscriber has received.
      // Both bus subscribers saw the same two events, never the failed one.
      yield* Console.log('email:', yield* TxQueue.takeAll(email))
      yield* Console.log('analytics:', yield* TxQueue.takeAll(analytics))
      yield* Console.log('status feed:', yield* TxQueue.takeAll(statusFeed))
    }),
  )

  yield* Console.log(`final status: ${yield* TxSubscriptionRef.get(status)}`)
})
