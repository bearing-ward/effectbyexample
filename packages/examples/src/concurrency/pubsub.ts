/**
 * @title Fan-out with PubSub
 * @difficulty intermediate
 * @summary A `Queue` gives each item to one consumer. A `PubSub` gives
 * every item to every subscriber, which is what you want for events: the
 * mailer, the analytics job and the audit log all hear about each order.
 */

import { Console, Effect, PubSub } from 'effect'

type OrderEvent = {
  readonly type: 'placed' | 'paid' | 'shipped'
  readonly orderId: string
}

const label = (events: ReadonlyArray<OrderEvent>) =>
  events.map((event) => `${event.type} ${event.orderId}`)

export const program = Effect.gen(function* () {
  // `bounded` caps how many unread events each subscriber may lag behind.
  // `replay` keeps the last few events for subscribers who join late.
  const events = yield* PubSub.bounded<OrderEvent>({ capacity: 16, replay: 1 })

  // Subscribing returns a `Subscription`, which lives in a scope. Only
  // events published after this point reach it, plus any replayed ones.
  const mailer = yield* PubSub.subscribe(events)
  const analytics = yield* PubSub.subscribe(events)

  const checkout: ReadonlyArray<OrderEvent> = [
    { type: 'placed', orderId: 'o-1' },
    { type: 'paid', orderId: 'o-1' },
  ]
  yield* PubSub.publishAll(events, checkout)

  // Each subscriber has its own copy of the stream of events. Reading from
  // one does not take anything away from the other.
  yield* Console.log('mailer:   ', label(yield* PubSub.takeAll(mailer)))
  yield* Console.log('analytics:', label(yield* PubSub.takeAll(analytics)))

  // A subscriber that joins now missed both events, except the one kept
  // for replay.
  const audit = yield* PubSub.subscribe(events)
  const shipped: OrderEvent = { type: 'shipped', orderId: 'o-1' }
  yield* PubSub.publish(events, shipped)
  yield* Console.log('audit:    ', label(yield* PubSub.takeAll(audit)))

  // `take` waits for the next event, so a subscriber can also run as a
  // loop in its own fiber.
  yield* Console.log('mailer:   ', label([yield* PubSub.take(mailer)]))
}).pipe(
  // Closing the scope ends the subscriptions.
  Effect.scoped,
)
