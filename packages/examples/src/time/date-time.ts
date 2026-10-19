/**
 * @title Dates and times
 * @difficulty beginner
 * @summary `DateTime` is an immutable point in time. Parsing returns an
 * `Option` instead of an `Invalid Date`, calendar math handles month ends
 * for you, and formatting is explicit about the output you want.
 */

import { Console, DateTime, Duration, Effect, Option } from 'effect'

export const program = Effect.gen(function* () {
  // `DateTime.make` accepts strings, epoch milliseconds, `Date` objects,
  // and objects of parts. It returns `None` for input that is not a date,
  // where `new Date` would give you an `Invalid Date` that fails later.
  const signedUp = DateTime.make('2025-01-31T09:30:00Z')
  yield* Console.log(Option.map(signedUp, DateTime.formatIso))
  yield* Console.log(Option.isNone(DateTime.make('next tuesday')))

  // When the value is a constant you trust, `makeUnsafe` skips the
  // `Option` and throws on bad input.
  const start = DateTime.makeUnsafe('2025-01-31T09:30:00Z')

  // `add` and `subtract` do calendar math and return a new value. Adding a
  // month to January 31st lands on the last day of February rather than
  // spilling over into March.
  const renewal = DateTime.add(start, { months: 1 })
  yield* Console.log(DateTime.formatIsoDate(renewal))
  yield* Console.log(DateTime.formatIso(DateTime.add(start, { hours: 36 })))

  // `startOf` and `endOf` snap to the edge of a unit. Here, the billing
  // period runs to the end of the renewal month.
  yield* Console.log(DateTime.formatIso(DateTime.endOf(renewal, 'month')))

  // `distance` gives the time between two instants as a `Duration`.
  const trialEnds = DateTime.makeUnsafe('2025-02-14T00:00:00Z')
  yield* Console.log(Duration.format(DateTime.distance(start, trialEnds)))

  // Comparisons read like sentences.
  yield* Console.log(DateTime.isLessThan(trialEnds, renewal))

  // `toParts` exposes the calendar fields. `weekDay` counts from Sunday as 0.
  const { year, month, day, weekDay } = DateTime.toParts(renewal)
  yield* Console.log({ year, month, day, weekDay })

  // `formatIso` is for machines. For people, `format` uses the platform's
  // `Intl` formatting, in UTC for a UTC value. Pass the locale explicitly
  // so the output does not depend on the machine the code runs on.
  yield* Console.log(
    DateTime.format(renewal, {
      locale: 'en-GB',
      dateStyle: 'full',
      timeStyle: 'short',
    }),
  )
})
