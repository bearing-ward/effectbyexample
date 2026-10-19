/**
 * @title Fairness and the Scheduler
 * @difficulty advanced
 * @summary JavaScript has one thread, so fibers take turns. The `Scheduler`
 * decides when: by default a busy fiber yields after a budget of about 2048
 * operations, letting others run. You can tune that budget or turn
 * yielding off, which trades fairness for throughput.
 */

import { Console, Effect, Fiber, Scheduler } from 'effect'

// A CPU-bound job that never waits on anything, plus a tiny "heartbeat"
// fiber forked before it starts. We record how far the job had got when
// the heartbeat finally ran.
const busyWithHeartbeat = Effect.gen(function* () {
  let processed = 0
  const heartbeat = yield* Effect.forkChild(Effect.sync(() => processed))
  for (let i = 0; i < 10_000; i++) {
    yield* Effect.sync(() => {
      processed++
    })
  }
  const seen = yield* Fiber.join(heartbeat)
  // Rounded, because the exact count depends on the work done before.
  return `heartbeat ran after about ${Math.round(seen / 100) * 100} of 10000 steps`
})

export const program = Effect.gen(function* () {
  // With the default budget, the busy fiber is paused part way through so
  // the heartbeat gets a turn. No sleep or explicit yield was needed.
  yield* Console.log('default:   ', yield* busyWithHeartbeat)

  // `MaxOpsBeforeYield` is the budget. A smaller one makes fibers take
  // turns more often, at the cost of more switching.
  yield* Console.log(
    'budget 100:',
    yield* busyWithHeartbeat.pipe(
      Effect.provideService(Scheduler.MaxOpsBeforeYield, 100),
    ),
  )

  // `PreventSchedulerYield` turns automatic yielding off. The busy fiber
  // keeps the thread until it is done, so the heartbeat waits for all of
  // it. Use this only for short, hot sections of code.
  yield* Console.log(
    'no yield:  ',
    yield* busyWithHeartbeat.pipe(
      Effect.provideService(Scheduler.PreventSchedulerYield, true),
    ),
  )

  // `Scheduler.Scheduler` is the scheduler itself, a reference with the
  // default `MixedScheduler`. Its mode is async: queued fibers resume on
  // a later turn of the JavaScript event loop.
  const scheduler = yield* Scheduler.Scheduler
  yield* Console.log('mode:', scheduler.executionMode)
})
