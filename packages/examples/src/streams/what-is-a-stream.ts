/**
 * @title What a stream is
 * @difficulty beginner
 * @summary A `Stream` is a description of many values produced over time.
 * Like an `Effect`, it does nothing until you run it, and the consumer pulls
 * values from it, so a stream only does the work the consumer asks for.
 */

import { Console, Effect, Stream } from 'effect'

// An `Effect` produces one value. A `Stream<A, E, R>` produces zero or more
// values of type `A`, may fail with `E`, and needs services `R`. Here the
// values are order numbers, and `tap` prints each one as it is produced.
const orderNumbers = Stream.range(1001, 1010).pipe(
  Stream.tap((id) => Console.log(`  loading order ${id}`)),
  Stream.map((id) => `order-${id}`),
)

export const program = Effect.gen(function* () {
  // Building the stream printed nothing. It is only a description, so it is
  // safe to define it once and run it many times.
  yield* Console.log('stream defined, nothing loaded yet')

  // A `run*` function turns a stream into an `Effect`. `runCollect` gathers
  // every value into an array.
  yield* Console.log('first run:')
  const all = yield* Stream.runCollect(orderNumbers)
  yield* Console.log(`collected ${all.length} orders`)

  // Streams are pull-based: downstream asks upstream for the next value.
  // `take(3)` stops asking after three values, so orders 1004 to 1010 are
  // never loaded at all.
  yield* Console.log('second run, first three only:')
  const firstThree = yield* Stream.runCollect(Stream.take(orderNumbers, 3))
  yield* Console.log(firstThree)

  // Each run starts from the beginning. A stream is a recipe, not a cursor
  // that remembers where the last run stopped.
  yield* Console.log('third run, first one only:')
  const head = yield* Stream.runHead(orderNumbers)
  yield* Console.log(head)
})
