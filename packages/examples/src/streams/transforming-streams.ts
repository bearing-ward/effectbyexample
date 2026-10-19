/**
 * @title Transforming streams
 * @difficulty beginner
 * @summary Stream operators look like array methods, but they work one value
 * at a time as values flow through. `map` and `filter` reshape values,
 * `mapEffect` runs an effect per value with bounded concurrency, `grouped`
 * batches values, and `scan` keeps a running state.
 */

import { Console, Effect, Ref, Stream } from 'effect'

interface Order {
  readonly id: string
  readonly status: 'paid' | 'cancelled'
  readonly cents: number
}

const orders = Stream.fromIterable<Order>([
  { id: 'o1', status: 'paid', cents: 1200 },
  { id: 'o2', status: 'cancelled', cents: 800 },
  { id: 'o3', status: 'paid', cents: 450 },
  { id: 'o4', status: 'paid', cents: 3000 },
  { id: 'o5', status: 'paid', cents: 990 },
  { id: 'o6', status: 'paid', cents: 2100 },
])

export const program = Effect.gen(function* () {
  // `filter` drops values and `map` transforms them, exactly like the array
  // methods, but lazily and one value at a time.
  const paidIds = orders.pipe(
    Stream.filter((order) => order.status === 'paid'),
    Stream.map((order) => order.id),
  )
  yield* Console.log(yield* Stream.runCollect(paidIds))

  // `mapEffect` runs an effect for each value. Here each paid order needs a
  // slow receipt lookup. `concurrency: 3` allows three lookups at a time.
  // We count lookups in flight to show the limit is respected.
  const inFlight = yield* Ref.make(0)
  const peak = yield* Ref.make(0)
  const lookupReceipt = (order: Order) =>
    Effect.gen(function* () {
      const now = yield* Ref.updateAndGet(inFlight, (n) => n + 1)
      yield* Ref.update(peak, (max) => Math.max(max, now))
      yield* Effect.sleep('10 millis')
      yield* Ref.update(inFlight, (n) => n - 1)
      return `receipt-${order.id}`
    })

  const receipts = yield* orders.pipe(
    Stream.filter((order) => order.status === 'paid'),
    Stream.mapEffect(lookupReceipt, { concurrency: 3 }),
    Stream.runCollect,
  )
  // Results keep the input order even though lookups overlap. Pass
  // `unordered: true` if you would rather have them as they finish.
  yield* Console.log(receipts)
  yield* Console.log(`peak lookups in flight: ${yield* Ref.get(peak)}`)

  // `grouped(n)` turns single values into batches of up to `n`, handy for
  // bulk inserts. The last batch may be smaller.
  const batches = yield* orders.pipe(
    Stream.map((order) => order.id),
    Stream.grouped(4),
    Stream.runCollect,
  )
  yield* Console.log(batches)

  // `scan` is a fold that emits every intermediate state. Here it produces
  // the running revenue after each paid order, starting with the initial 0.
  const runningTotal = yield* orders.pipe(
    Stream.filter((order) => order.status === 'paid'),
    Stream.scan(
      () => 0,
      (total, order) => total + order.cents,
    ),
    Stream.runCollect,
  )
  yield* Console.log(runningTotal)
})
