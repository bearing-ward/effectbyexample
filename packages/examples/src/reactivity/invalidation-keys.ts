/**
 * @title Invalidation keys with Reactivity
 * @difficulty intermediate
 * @summary `Reactivity` connects writes to the reads that depend on them.
 * A query registers under some keys, and a mutation invalidates keys when it
 * succeeds. Every query listening on those keys runs again. Nothing is
 * cached; it only answers "what should reload now?".
 */

import { Console, Effect, Queue, Ref, Schema } from 'effect'
import { Reactivity } from 'effect/reactivity'

class OutOfStock extends Schema.TaggedError<OutOfStock>()('OutOfStock', {
  sku: Schema.String,
}) {}

export const program = Effect.gen(function* () {
  // A pretend database with orders and customers. `Reactivity` is marked
  // `@stability unstable`.
  const orders = yield* Ref.make<Array<string>>(['order-1'])
  const customers = yield* Ref.make<Array<string>>(['Ada'])

  // `Reactivity.query` runs the effect once and again whenever one of its
  // keys is invalidated. Each result lands in the returned queue. The
  // registration ends when the surrounding scope closes.
  const orderList = yield* Reactivity.query(Ref.get(orders), ['orders'])
  const customerList = yield* Reactivity.query(Ref.get(customers), [
    'customers',
  ])
  yield* Console.log('orders:', yield* Queue.take(orderList))
  yield* Console.log('customers:', yield* Queue.take(customerList))

  // `Reactivity.mutation` wraps a write. After the write succeeds, it
  // invalidates the keys, so the orders query reruns. The customers query
  // listens on a different key and stays put. These queries read memory,
  // so a rerun finishes at once and the queue sizes tell us what ran.
  const placeOrder = (id: string) =>
    Ref.update(orders, (all) => [...all, id]).pipe(
      Reactivity.mutation(['orders']),
    )
  yield* placeOrder('order-2')
  yield* Console.log('orders:', yield* Queue.take(orderList))
  yield* Console.log(
    `customer results waiting: ${yield* Queue.size(customerList)}`,
  )

  // If the write fails, nothing is invalidated. There is no new data to
  // load, so readers are not disturbed.
  const failedOrder = Effect.fail(new OutOfStock({ sku: 'kettle' })).pipe(
    Reactivity.mutation(['orders']),
  )
  yield* Effect.exit(failedOrder)
  yield* Console.log(`order results waiting: ${yield* Queue.size(orderList)}`)

  // `invalidate` signals a change made somewhere else, such as a message
  // from another tab.
  yield* Ref.update(customers, (all) => [...all, 'Grace'])
  yield* Reactivity.invalidate(['customers'])
  yield* Console.log('customers:', yield* Queue.take(customerList))
}).pipe(Effect.scoped, Effect.provide(Reactivity.layer))
