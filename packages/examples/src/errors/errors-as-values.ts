/**
 * @title Errors as values with Result
 * @difficulty beginner
 * @summary Sometimes you want to keep going after a failure and decide later.
 * `Effect.result` turns an effect's outcome into a `Result`: a plain value
 * that is either a `Success` or a `Failure`. `Result` also works on its own,
 * in code that is not effectful at all.
 */

import { Console, Effect, Result, Schema } from 'effect'

class InvalidCoupon extends Schema.TaggedError<InvalidCoupon>()(
  'InvalidCoupon',
  { code: Schema.String },
) {}

const coupons = new Map([
  ['SPRING10', 10],
  ['VIP25', 25],
])

const redeem = (code: string) =>
  Effect.gen(function* () {
    const percent = coupons.get(code)
    if (percent === undefined) return yield* new InvalidCoupon({ code })
    return percent
  })

// `Result` is synchronous. This helper never needs an Effect runtime.
const parseQuantity = (input: string): Result.Result<number, string> => {
  const quantity = Number(input)
  return Number.isInteger(quantity) && quantity > 0
    ? Result.succeed(quantity)
    : Result.fail(`"${input}" is not a quantity`)
}

export const program = Effect.gen(function* () {
  // `Effect.result` never fails. The error moved into the value:
  // `Effect<Result<number, InvalidCoupon>>`.
  const outcomes = yield* Effect.forEach(
    ['SPRING10', 'FREE', 'VIP25'],
    (code) => Effect.result(redeem(code)),
  )

  // `Result.match` handles both cases and returns one value.
  for (const outcome of outcomes) {
    yield* Console.log(
      Result.match(outcome, {
        onSuccess: (percent) => `${percent}% off`,
        onFailure: (error) => `${error._tag}: ${error.code}`,
      }),
    )
  }

  // Because they are values, results are easy to sort into piles.
  const valid = outcomes
    .filter(Result.isSuccess)
    .map((outcome) => outcome.success)
  yield* Console.log('valid discounts:', valid)

  // `Result.map` transforms a success and leaves a failure alone.
  // `getOrElse` supplies a fallback for the failure case.
  for (const input of ['3', 'three']) {
    const label = parseQuantity(input).pipe(
      Result.map((quantity) => `${quantity} mugs`),
      Result.getOrElse((reason) => `skipped: ${reason}`),
    )
    yield* Console.log(label)
  }

  // `Effect.fromResult` goes the other way: a failure becomes the effect's
  // error, so you can move from plain values back into effect code.
  const back = yield* Effect.fromResult(parseQuantity('zero')).pipe(Effect.flip)
  yield* Console.log('as an effect error:', back)
})
