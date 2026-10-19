/**
 * @title Cron expressions
 * @difficulty intermediate
 * @summary The `Cron` module parses the familiar five or six field cron
 * syntax, in a time zone of your choice, and answers "when does this run
 * next?" and "does this run at that moment?". `Schedule.cron` turns an
 * expression into a schedule you can repeat an effect with.
 */

import {
  Clock,
  Console,
  Cron,
  DateTime,
  Effect,
  Fiber,
  Result,
  Schedule,
} from 'effect'
import { TestClock } from 'effect/testing'

// Print an occurrence in the zone the schedule was written for.
const inLondon = (date: Date) =>
  DateTime.formatIsoZoned(
    DateTime.makeZonedUnsafe(date, { timeZone: 'Europe/London' }),
  )

export const program = Effect.gen(function* () {
  // Weekdays at 09:00, London time. The fields are minute, hour, day of
  // month, month, and day of week. `parse` returns a `Result`, so a typo
  // in configuration becomes a value you can report.
  const digest = Cron.parseUnsafe('0 9 * * 1-5', 'Europe/London')

  // Starting from a fixed Thursday morning, after that day's run, `next`
  // finds Friday's.
  const thursday = DateTime.makeUnsafe('2025-03-27T10:00:00Z')
  yield* Console.log(inLondon(Cron.next(digest, thursday)))

  // `sequence` is a lazy, endless iterator of runs. It skips the weekend.
  // The clocks change in London on 30 March, so the UTC offset changes,
  // but every run stays at 09:00 on the wall clock.
  const runs = Cron.sequence(digest, thursday)
  for (let i = 0; i < 3; i++) {
    yield* Console.log(inLondon(runs.next().value))
  }

  // `match` checks one moment against the expression. 08:00 UTC on Monday
  // 31 March is 09:00 in London, so it matches. Saturday does not.
  yield* Console.log(
    Cron.match(digest, DateTime.makeUnsafe('2025-03-31T08:00:00Z')),
  )
  yield* Console.log(
    Cron.match(digest, DateTime.makeUnsafe('2025-03-29T09:00:00Z')),
  )

  // Invalid expressions fail with a `CronParseError` that says what is
  // wrong.
  const broken = Cron.parse('0 25 * * *')
  if (Result.isFailure(broken)) {
    yield* Console.log(broken.failure.message)
  }

  // `Schedule.cron` waits until each occurrence. Here a job repeats on a
  // six-field expression with seconds: every 15 seconds. `repeat` runs it
  // once right away, then at each occurrence. The test clock supplies a
  // fixed start and fast-forwards, so nothing really waits.
  yield* TestClock.setTime(DateTime.toEpochMillis(thursday))
  const job = Effect.gen(function* () {
    const now = DateTime.makeUnsafe(yield* Clock.currentTimeMillis)
    yield* Console.log(`job ran at ${DateTime.formatIso(now)}`)
  })
  const fiber = yield* job.pipe(
    Effect.repeat(
      Schedule.max([Schedule.cron('*/15 * * * * *'), Schedule.recurs(3)]),
    ),
    Effect.forkChild,
  )
  yield* TestClock.adjust('5 minutes')
  yield* Fiber.join(fiber)
}).pipe(Effect.provide(TestClock.layer()))
