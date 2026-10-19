/**
 * @title Cron jobs
 * @difficulty intermediate
 * @summary A cron job in a cluster should run once per tick, not once per
 * machine. `ClusterCron` schedules each run as a persisted message with a
 * delivery time, so exactly one runner executes it, and a restart does not
 * lose the next run.
 */

import { Console, Cron, DateTime, Effect, Layer, Ref, Schedule } from 'effect'
import { ClusterCron, TestRunner } from 'effect/cluster'
import { TestClock } from 'effect/testing'

export const program = Effect.gen(function* () {
  // Waiting for real five-minute ticks would take a while, so this example
  // runs on a `TestClock` that we move forward by hand.
  yield* TestClock.setTime(Date.UTC(2026, 0, 5, 8, 58))
  const runs = yield* Ref.make(0)

  // `ClusterCron.make` returns a layer. Give the time zone explicitly:
  // without it, the schedule follows the local time zone of each machine.
  const CleanupJob = ClusterCron.make({
    name: 'ExpireSessions',
    cron: Cron.parseUnsafe('*/5 * * * *', 'UTC'),
    execute: Effect.gen(function* () {
      const now = yield* DateTime.now
      yield* Console.log(`expiring sessions at ${DateTime.formatIso(now)}`)
      yield* Ref.update(runs, (count) => count + 1)
    }),
  })

  // Under the hood a singleton sends the first run to a cron entity. Each
  // run then schedules the next with `DeliverAt`, so no runner keeps a
  // timer of its own.
  yield* Effect.gen(function* () {
    for (let expected = 1; expected <= 3; expected++) {
      yield* TestClock.adjust('5 minutes')
      // Each adjust wakes the cluster's polling loops. We wait, on the real
      // clock, until the run has happened.
      yield* Ref.get(runs).pipe(
        Effect.repeat({
          until: (count) => count === expected,
          schedule: Schedule.spaced('1 millis'),
        }),
        TestClock.withLive,
      )
    }
  }).pipe(Effect.provide(CleanupJob.pipe(Layer.provideMerge(TestRunner.layer))))
}).pipe(Effect.provide(TestClock.layer()))
