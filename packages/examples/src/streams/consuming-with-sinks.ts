/**
 * @title Consuming streams with sinks
 * @difficulty intermediate
 * @summary A stream does nothing until something consumes it. The `run*`
 * functions cover common cases, and a `Sink` is a reusable consumer you can
 * build, transform, and pass to `Stream.run`. Sinks can also stop early and
 * hand unused values back as leftovers.
 */

import { Console, Effect, Sink, Stream } from 'effect'

interface Payment {
  readonly customer: string
  readonly cents: number
}

const payments = Stream.fromIterable<Payment>([
  { customer: 'ada', cents: 1200 },
  { customer: 'grace', cents: 300 },
  { customer: 'ada', cents: 4500 },
  { customer: 'alan', cents: 800 },
  { customer: 'grace', cents: 2500 },
])

export const program = Effect.gen(function* () {
  // The `run*` helpers are shortcuts for the usual questions: how many,
  // what is the total, what is the first value.
  yield* Console.log(`count: ${yield* Stream.runCount(payments)}`)
  const total = yield* Stream.runFold(
    payments,
    () => 0,
    (sum, payment) => sum + payment.cents,
  )
  yield* Console.log(`total: ${total}`)

  // `runForEach` runs an effect per value and discards the results.
  yield* Stream.runForEach(payments.pipe(Stream.take(2)), (payment) =>
    Console.log(`charging ${payment.customer} ${payment.cents}`),
  )

  // A `Sink<A, In, L, E, R>` consumes values of type `In` and produces one
  // `A`. `Sink.sum` adds numbers. `mapInput` adapts it to read payments,
  // and `map` reshapes the result, so the consumer is a value you can name.
  const revenueInDollars = Sink.sum.pipe(
    Sink.mapInput((payment: Payment) => payment.cents),
    Sink.map((cents) => `$${(cents / 100).toFixed(2)}`),
  )
  yield* Console.log(
    `revenue: ${yield* Stream.run(payments, revenueInDollars)}`,
  )

  // `Sink.every` stops pulling as soon as the answer is known. The first
  // payment under 1000 cents settles it, so the rest are never read.
  const allLarge = Sink.every((payment: Payment) => payment.cents >= 1000)
  const checked = payments.pipe(
    Stream.tap((payment) => Console.log(`  checked ${payment.customer}`)),
  )
  yield* Console.log(`all large: ${yield* Stream.run(checked, allLarge)}`)

  // A sink that stops early may leave values unconsumed. Those are its
  // leftovers (the `L` type). `Stream.transduce` uses this: it runs the sink
  // again on the leftovers, over and over, emitting one result per run.
  // `Sink.take(2)` keeps two values and leaves the rest, so this cuts the
  // stream into pairs.
  const pairs = yield* payments.pipe(
    Stream.map((payment) => payment.customer),
    Stream.transduce(Sink.take(2)),
    Stream.runCollect,
  )
  yield* Console.log(pairs)
})
