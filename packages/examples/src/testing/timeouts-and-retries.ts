/**
 * @title Testing timeouts and retries
 * @difficulty intermediate
 * @summary Timeouts, retries, and schedules all read the same `Clock`. Under
 * `TestClock` you can step through a backoff schedule one delay at a time and
 * check exactly when each attempt happens.
 */

import { Clock, Console, Effect, Fiber, Schedule, Schema } from 'effect'
import { TestClock } from 'effect/testing'

class GatewayUnavailable extends Schema.TaggedError<GatewayUnavailable>()(
  'GatewayUnavailable',
  {},
) {}

// A payment call that fails until its third attempt. Each attempt logs the
// virtual time it ran at.
const makeChargeCard = () => {
  let attempts = 0
  return Effect.gen(function* () {
    attempts++
    const at = yield* Clock.currentTimeMillis
    yield* Console.log(`attempt ${attempts} at ${at}ms`)
    if (attempts < 3) {
      return yield* new GatewayUnavailable()
    }
    return 'charged'
  })
}

const test = Effect.gen(function* () {
  // Retry with exponential backoff: wait 100ms, then 200ms.
  const charge = makeChargeCard().pipe(
    Effect.retry(Schedule.exponential('100 millis')),
  )
  const fiber = yield* Effect.forkChild(charge)

  // The first attempt runs right away. Each `adjust` releases the next one,
  // so the log shows the schedule's delays exactly.
  yield* TestClock.adjust('100 millis')
  yield* TestClock.adjust('200 millis')
  yield* Console.log(yield* Fiber.join(fiber))

  // A timeout is a race against a sleep. Here the lookup takes 5 seconds and
  // the timeout is 2, so moving the clock 2 seconds decides the race.
  const slowLookup = Effect.sleep('5 seconds').pipe(
    Effect.as('found'),
    Effect.timeout('2 seconds'),
    Effect.catchTag('TimeoutError', () => Effect.succeed('timed out')),
  )
  const lookup = yield* Effect.forkChild(slowLookup)
  yield* TestClock.adjust('2 seconds')
  yield* Console.log(yield* Fiber.join(lookup))
})

export const program = test.pipe(Effect.provide(TestClock.layer()))
