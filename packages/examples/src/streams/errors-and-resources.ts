/**
 * @title Errors and resources in streams
 * @difficulty intermediate
 * @summary A stream can fail partway through, and it can hold resources such
 * as connections or file handles. Effect releases those resources whether
 * the stream finishes, fails, or is cut short, and gives you operators to
 * recover from or retry typed failures.
 */

import { Console, Effect, Ref, Schedule, Schema, Stream } from 'effect'

class FeedError extends Schema.TaggedError<FeedError>()('FeedError', {
  line: Schema.Number,
}) {}

// A fake connection to a price feed. `acquireRelease` pairs opening with
// closing, and `Stream.scoped` ties the connection's lifetime to the
// stream: it closes when the stream ends, however it ends.
const connection = Effect.acquireRelease(
  Console.log('  open connection').pipe(Effect.as({ symbol: 'ACME' })),
  () => Console.log('  close connection'),
)

// The feed emits prices and fails at line `failAt`, if given.
const priceFeed = (failAt?: number) =>
  Stream.fromEffect(connection).pipe(
    Stream.flatMap(({ symbol }) =>
      Stream.range(1, 4).pipe(
        Stream.mapEffect((line) =>
          line === failAt
            ? Effect.fail(new FeedError({ line }))
            : Effect.succeed(`${symbol} line ${line}`),
        ),
      ),
    ),
    Stream.scoped,
  )

export const program = Effect.gen(function* () {
  // Taking two values stops the stream early. The connection still closes.
  yield* Console.log('take two:')
  yield* Console.log(yield* Stream.runCollect(Stream.take(priceFeed(), 2)))

  // A failure ends the stream and the error shows up in the type of
  // `runCollect`. `Stream.catchTag` switches to a fallback stream instead.
  // Values emitted before the failure are kept.
  yield* Console.log('fail at line 3, then fall back:')
  const recovered = yield* priceFeed(3).pipe(
    Stream.catchTag('FeedError', (error) =>
      Stream.make(`feed broke at line ${error.line}, using cached price`),
    ),
    Stream.runCollect,
  )
  yield* Console.log(recovered)

  // `Stream.retry` reruns the whole stream from the start after a failure,
  // here up to two more times. The first attempt fails at line 2, the second
  // works, and the connection closes after each attempt. Values that the
  // failed attempt already emitted stay downstream, so line 1 appears twice.
  // Retry close to the source, or make consumers tolerate repeats.
  yield* Console.log('retry a flaky feed:')
  const attempts = yield* Ref.make(0)
  const flaky = Stream.unwrap(
    Ref.updateAndGet(attempts, (n) => n + 1).pipe(
      Effect.map((attempt) => priceFeed(attempt === 1 ? 2 : undefined)),
    ),
  )
  const retried = yield* flaky.pipe(
    Stream.retry(Schedule.recurs(2)),
    Stream.runCollect,
  )
  yield* Console.log(retried)
  yield* Console.log(`attempts: ${yield* Ref.get(attempts)}`)
})
