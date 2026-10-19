/**
 * @title Clock and Random as services
 * @difficulty intermediate
 * @summary Effect reads the current time from the `Clock` service and
 * random numbers from the `Random` service. Code that uses them instead of
 * `Date.now()` and `Math.random()` can be run with a fixed time and a fixed
 * seed, which makes it repeatable in tests and in examples like this one.
 */

import { Clock, Console, DateTime, Effect, Fiber, Random } from 'effect'
import { TestClock } from 'effect/testing'

// Issue a password reset token: a random code that expires in 15 minutes.
// Nothing here says where time or randomness comes from.
const issueResetToken = Effect.gen(function* () {
  const code = yield* Random.nextIntBetween(100_000, 999_999)
  const now = yield* DateTime.now
  const expires = DateTime.add(now, { minutes: 15 })
  return { code, expires: DateTime.formatIso(expires) }
})

export const program = Effect.gen(function* () {
  // `TestClock` replaces the `Clock` service with one that only moves when
  // told to. We start it at a fixed instant.
  yield* TestClock.setTime(
    DateTime.toEpochMillis(DateTime.makeUnsafe('2025-06-01T12:00:00Z')),
  )
  yield* Console.log(yield* Clock.currentTimeMillis)

  // `Random.withSeed` swaps in a seeded generator for one effect. The same
  // seed gives the same sequence on every run.
  const first = yield* Random.withSeed(issueResetToken, 'reset-demo')
  const again = yield* Random.withSeed(issueResetToken, 'reset-demo')
  yield* Console.log(first)
  yield* Console.log(first.code === again.code)

  // Time stands still until we move it. `adjust` moves the clock forward.
  yield* TestClock.adjust('20 minutes')
  const later = yield* Random.withSeed(issueResetToken, 'other-seed')
  yield* Console.log(later)

  // `Effect.sleep` also goes through the `Clock`, so a sleeping fiber
  // wakes when the test clock passes its wake-up time, with no real
  // waiting. This reminder would otherwise take an hour.
  const reminder = yield* Effect.forkChild(
    Effect.sleep('1 hour').pipe(
      Effect.andThen(DateTime.now),
      Effect.map((at) => `reminder sent at ${DateTime.formatIso(at)}`),
    ),
  )
  yield* TestClock.adjust('1 hour')
  yield* Console.log(yield* Fiber.join(reminder))
}).pipe(
  // Without this layer the program would read the real system clock.
  Effect.provide(TestClock.layer()),
)
