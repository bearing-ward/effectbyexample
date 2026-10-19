/**
 * @title Durations
 * @difficulty beginner
 * @summary A bare number like `5000` does not say whether it means
 * milliseconds or seconds. A `Duration` carries its unit, can be written as
 * readable text like `"5 seconds"`, and supports the arithmetic and
 * comparisons you need for timeouts and budgets.
 */

import { Array, Console, Duration, Effect } from 'effect'

export const program = Effect.gen(function* () {
  // Constructors name the unit. Effect APIs that take a duration, such as
  // `Effect.sleep` or `Effect.timeout`, also accept strings like
  // "250 millis" and objects like `{ minutes: 1, seconds: 30 }`.
  const connect = Duration.millis(250)
  const query = Duration.fromInputUnsafe('1.5 seconds')
  const render = Duration.fromInputUnsafe({ seconds: 2, milliseconds: 100 })

  // `format` prints a duration for people, picking units as needed.
  yield* Console.log(Duration.format(render))

  // Arithmetic returns new durations. Here we add up the stages of a page
  // load and compare the total with a three second budget.
  const total = Duration.sum(Duration.sum(connect, query), render)
  const budget = Duration.seconds(3)
  yield* Console.log(Duration.format(total))
  yield* Console.log(Duration.isGreaterThan(total, budget))

  // `subtract` gives the overrun, and the `to*` functions convert to a
  // number in the unit you ask for.
  yield* Console.log(Duration.toMillis(Duration.subtract(total, budget)))

  // `clamp` keeps a value inside bounds, which is handy for a retry delay
  // read from a server header.
  const fromHeader = Duration.minutes(10)
  const delay = Duration.clamp(fromHeader, {
    minimum: Duration.seconds(1),
    maximum: Duration.seconds(30),
  })
  yield* Console.log(Duration.format(delay))

  // `Duration.Order` compares durations, so the `Array` helpers can sort
  // them or, as here, pick the slowest stage.
  const stages = [connect, query, render] as const
  yield* Console.log(Duration.format(Array.max(stages, Duration.Order)))

  // `parts` splits a duration into calendar-free components.
  yield* Console.log(Duration.parts(Duration.fromInputUnsafe('90061 seconds')))

  // `infinity` is a real value, useful as "no timeout".
  yield* Console.log(Duration.isFinite(Duration.infinity))
})
