/**
 * @title Selecting failures with Filter
 * @difficulty intermediate
 * @summary A `Filter` is a function that either accepts a value, optionally
 * transforming it, or rejects it. Effect 4 uses filters to pick which errors,
 * causes, or items an operator should act on. You can pass a built-in filter
 * or write your own.
 */

import { Cause, Console, Effect, Filter, Result, Schema } from 'effect'

class GatewayError extends Schema.TaggedError<GatewayError>()('GatewayError', {
  status: Schema.Number,
}) {}

class CardDeclined extends Schema.TaggedError<CardDeclined>()('CardDeclined', {
  reason: Schema.String,
}) {}

type PaymentError = GatewayError | CardDeclined

// A filter returns a `Result`. `Result.succeed` means "accepted", carrying the
// value to pass on. `Result.fail` means "rejected", carrying what is left.
// This one accepts gateway outages and passes on only the status code.
const outage: Filter.Filter<PaymentError, number> = Filter.make((error) =>
  error._tag === 'GatewayError' && error.status >= 500
    ? Result.succeed(error.status)
    : Result.fail(error),
)

const charge = (error: PaymentError) => Effect.fail(error)

export const program = Effect.gen(function* () {
  // A filter is a plain function, so you can call it directly.
  yield* Console.log(outage(new GatewayError({ status: 503 }))._tag)
  yield* Console.log(outage(new GatewayError({ status: 400 }))._tag)

  // `catchFilter` recovers only from errors the filter accepts. The handler
  // receives the filter's output, here the status code.
  const queued = yield* charge(new GatewayError({ status: 503 })).pipe(
    Effect.catchFilter(outage, (status) =>
      Effect.succeed(`queued, gateway said ${status}`),
    ),
  )
  yield* Console.log(queued)

  // Rejected errors pass through untouched.
  const declined = yield* charge(new CardDeclined({ reason: 'expired' })).pipe(
    Effect.catchFilter(outage, () => Effect.succeed('queued')),
    Effect.flip,
  )
  yield* Console.log('not caught:', declined._tag)

  // Built-in filters cover common cases. `Filter.tagged` accepts one tag.
  const told = yield* charge(new CardDeclined({ reason: 'expired' })).pipe(
    Effect.catchFilter(Filter.tagged('CardDeclined'), (error) =>
      Effect.succeed(`tell the customer: card ${error.reason}`),
    ),
  )
  yield* Console.log(told)

  // Filters also work on whole causes. `Cause.findDefect` is a filter that
  // accepts a cause containing a defect. `tapCauseFilter` uses it to report
  // bugs without handling them.
  const bug = yield* Effect.die('totals do not add up').pipe(
    Effect.tapCauseFilter(Cause.findDefect, (defect) =>
      Console.log('bug report:', defect),
    ),
    Effect.catchDefect(() => Effect.succeed('shown an error page')),
  )
  yield* Console.log(bug)

  // Outside error handling, `Effect.filterMap` keeps the accepted items and
  // their transformed values, dropping the rest.
  const parseCents = Filter.make((input: string) => {
    const cents = Number(input)
    return Number.isInteger(cents) ? Result.succeed(cents) : Result.fail(input)
  })
  const amounts = yield* Effect.filterMap(['1200', 'n/a', '350'], parseCents)
  yield* Console.log('amounts:', amounts)
})
