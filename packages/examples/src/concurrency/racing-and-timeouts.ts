/**
 * @title Racing and timeouts
 * @difficulty intermediate
 * @summary Racing runs effects side by side and keeps the first result; the
 * losers are interrupted, so their cleanup runs. A timeout is a race
 * against the clock. Here a test clock moves time, so the outcome never
 * depends on how fast the machine is.
 */

import { Console, Effect, Fiber } from 'effect'
import { TestClock } from 'effect/testing'

// A request to one replica of a pricing service. It takes `millis` to
// answer, and says so if it is interrupted before then.
const askReplica = (
  name: string,
  millis: number,
  outcome: 'ok' | 'error' = 'ok',
) =>
  Effect.sleep(`${millis} millis`).pipe(
    Effect.andThen(
      outcome === 'ok'
        ? Effect.succeed(`price from ${name}`)
        : Effect.fail(`${name} errored`),
    ),
    Effect.onInterrupt(() => Console.log(`  ${name}: cancelled`)),
  )

// Runs an effect in a fiber and moves the test clock a minute ahead, so
// every sleep inside finishes in order without real waiting.
const withTime = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(effect)
    yield* TestClock.adjust('1 minute')
    return yield* Fiber.join(fiber)
  })

export const program = Effect.gen(function* () {
  // `Effect.race` returns the first success. The slower replica is
  // interrupted.
  yield* Console.log(
    yield* withTime(Effect.race(askReplica('eu', 30), askReplica('us', 10))),
  )

  // A failure does not win a `race`; it waits for the other side.
  yield* Console.log(
    yield* withTime(
      Effect.race(askReplica('eu', 30), askReplica('us', 10, 'error')),
    ),
  )

  // `Effect.raceFirst` takes whichever finishes first, success or failure.
  const first = yield* withTime(
    Effect.raceFirst(askReplica('eu', 30), askReplica('us', 10, 'error')),
  ).pipe(Effect.catch((error) => Effect.succeed(`raceFirst failed: ${error}`)))
  yield* Console.log(first)

  // `Effect.timeout` fails with a `TimeoutError` when time runs out, and
  // interrupts the slow effect.
  const timedOut = yield* withTime(
    askReplica('eu', 500).pipe(Effect.timeout('100 millis')),
  ).pipe(Effect.catchTag('TimeoutError', () => Effect.succeed('timed out')))
  yield* Console.log(timedOut)

  // `Effect.timeoutOrElse` swaps in a fallback instead, such as a cached
  // price.
  yield* Console.log(
    yield* withTime(
      askReplica('eu', 500).pipe(
        Effect.timeoutOrElse({
          duration: '100 millis',
          orElse: () => Effect.succeed('cached price'),
        }),
      ),
    ),
  )
}).pipe(Effect.provide(TestClock.layer()))
