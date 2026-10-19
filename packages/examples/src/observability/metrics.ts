/**
 * @title Counters, gauges, and histograms
 * @difficulty intermediate
 * @summary A metric is a named number your program keeps up to date, such as
 * orders placed or jobs waiting. `Metric` provides counters, gauges,
 * histograms and frequencies, and lets you read their current values
 * without any exporter installed.
 */

import { Console, Effect, Metric } from 'effect'

// A counter only goes up. Attributes split one metric into several series,
// here one per region.
const ordersPlaced = Metric.counter('orders_placed', {
  description: 'Orders accepted by checkout',
})

// A gauge holds the latest value of something that goes up and down.
const jobsWaiting = Metric.gauge('jobs_waiting')

// A histogram counts observations into buckets. Each boundary is the upper
// limit of a bucket, so you can ask how many orders were under 50 dollars.
const orderValue = Metric.histogram('order_value_dollars', {
  boundaries: [10, 50, 100],
})

// A frequency counts how often each distinct string occurs.
const paymentMethods = Metric.frequency('payment_method')

const placeOrder = (region: string, dollars: number, method: string) =>
  Effect.gen(function* () {
    // `Metric.update` feeds one input to a metric. For a counter the input
    // is added to the count.
    yield* Metric.update(Metric.withAttributes(ordersPlaced, { region }), 1)
    yield* Metric.update(orderValue, dollars)
    yield* Metric.update(paymentMethods, method)
  })

export const program = Effect.gen(function* () {
  yield* placeOrder('eu', 12, 'card')
  yield* placeOrder('eu', 80, 'card')
  yield* placeOrder('us', 240, 'invoice')

  // For a gauge, `update` replaces the value and `modify` adds to it.
  yield* Metric.update(jobsWaiting, 5)
  yield* Metric.modify(jobsWaiting, -2)

  // `Metric.value` reads a metric's current state. Each metric type has its
  // own state shape.
  const eu = yield* Metric.value(
    Metric.withAttributes(ordersPlaced, { region: 'eu' }),
  )
  yield* Console.log('eu orders:', eu.count)
  yield* Console.log('jobs waiting:', (yield* Metric.value(jobsWaiting)).value)

  const histogram = yield* Metric.value(orderValue)
  yield* Console.log('order values:', {
    count: histogram.count,
    min: histogram.min,
    max: histogram.max,
    sum: histogram.sum,
  })
  // Buckets are cumulative: each one counts every value up to its boundary.
  // The 240 dollar order is above every boundary, so only `count` has it.
  yield* Console.log('buckets:', histogram.buckets)

  const methods = yield* Metric.value(paymentMethods)
  yield* Console.log(
    'payment methods:',
    Object.fromEntries(methods.occurrences),
  )

  // `Metric.snapshot` lists every metric series that has been used, which is
  // what exporters read. Each attribute combination is its own series.
  for (const series of yield* Metric.snapshot) {
    yield* Console.log(series.type, series.id, series.attributes ?? {})
  }
}).pipe(
  // Metrics live in a `MetricRegistry`. By default there is one per runtime;
  // this page provides a fresh one so every run starts from zero.
  Effect.provideServiceEffect(
    Metric.MetricRegistry,
    Effect.sync(() => new Map()),
  ),
)
