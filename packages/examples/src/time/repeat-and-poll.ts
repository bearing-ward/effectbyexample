/**
 * @title Repeating and polling
 * @difficulty intermediate
 * @summary `Effect.repeat` runs an effect again after each success,
 * following a `Schedule`. The same schedules used for retries describe
 * heartbeats, sync loops, and polling until a job is done.
 */

import { Clock, Console, Effect, Fiber, Schedule } from 'effect'
import { TestClock } from 'effect/testing'

// Run an effect in a fiber while the test clock jumps forward, so the
// schedule's waits pass instantly and the printed times are exact.
const withTimePassing = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    yield* TestClock.setTime(0)
    const fiber = yield* Effect.forkChild(effect)
    yield* TestClock.adjust('1 minute')
    return yield* Fiber.join(fiber)
  })

// A sync task that takes one second of work each time it runs.
const sync = Effect.gen(function* () {
  yield* Console.log(
    `  sync started at ${(yield* Clock.currentTimeMillis) / 1000}s`,
  )
  yield* Effect.sleep('1 second')
})

export const program = Effect.gen(function* () {
  // `spaced` waits the given time after each run finishes. Combined with
  // `recurs(3)` through `Schedule.max`, it repeats three times, so the task
  // runs four times. Each start is three seconds after the previous one:
  // one second of work plus two of waiting.
  yield* Console.log('spaced 2s')
  yield* withTimePassing(
    Effect.repeat(
      sync,
      Schedule.max([Schedule.spaced('2 seconds'), Schedule.recurs(3)]),
    ),
  )

  // `fixed` keeps a steady beat instead. It starts counting when the first
  // run finishes, and from then on starts are two seconds apart however
  // long the task takes. That suits jobs that should run "every two
  // seconds".
  yield* Console.log('fixed 2s')
  yield* withTimePassing(
    Effect.repeat(
      sync,
      Schedule.max([Schedule.fixed('2 seconds'), Schedule.recurs(3)]),
    ),
  )

  // Polling: check an export job until it is ready. Each check returns the
  // job's progress.
  let checks = 0
  const checkExport = Effect.gen(function* () {
    const progress = Math.min(++checks * 20, 100)
    yield* Console.log(
      `  ${(yield* Clock.currentTimeMillis) / 1000}s: ${progress}%`,
    )
    return progress
  })

  // `concat` runs one schedule after another: check every second three
  // times while the job is likely to finish soon, then back off to every
  // five seconds. `until` stops repeating once the value says we are done,
  // and `repeat` returns that value.
  const pollEagerlyThenSlowly = Schedule.spaced('1 second').pipe(
    Schedule.upTo({ times: 3 }),
    Schedule.concat(Schedule.spaced('5 seconds')),
  )
  yield* Console.log('polling')
  const final = yield* withTimePassing(
    Effect.repeat(checkExport, {
      schedule: pollEagerlyThenSlowly,
      until: (p) => p === 100,
    }),
  )
  yield* Console.log(`  done at ${final}%`)
}).pipe(Effect.provide(TestClock.layer()))
