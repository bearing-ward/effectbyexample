/**
 * @title Numbers, BigInt, and BigDecimal
 * @difficulty intermediate
 * @summary The `Number` and `BigInt` modules wrap everyday arithmetic in
 * functions that return `Option` where JavaScript would return `NaN`,
 * `Infinity`, or throw. `BigDecimal` does exact decimal math, which is what
 * you want for money.
 */

import { BigDecimal, BigInt, Console, Effect, Number, Option } from 'effect'

export const program = Effect.gen(function* () {
  // `Number.parse` returns `None` instead of `NaN` for bad input, and
  // `Number.divide` returns `None` instead of `Infinity` for division by 0.
  yield* Console.log(Number.parse('12.5'), Number.parse('twelve'))
  yield* Console.log('average:', Number.divide(120, 0))

  // Plus helpers you would otherwise write yourself.
  yield* Console.log(
    'discount:',
    Number.clamp(130, { minimum: 0, maximum: 100 }),
  )
  yield* Console.log('items:', Number.sumAll([2, 1, 4]))

  // Floats cannot hold most decimals exactly. A price list that adds 0.10
  // and 0.20 gets a surprise.
  yield* Console.log('float:', 0.1 + 0.2)

  // `BigDecimal` stores digits exactly, so decimal sums come out right.
  const tenCents = BigDecimal.fromStringUnsafe('0.10')
  const twentyCents = BigDecimal.fromStringUnsafe('0.20')
  yield* Console.log(
    'BigDecimal:',
    BigDecimal.format(BigDecimal.sum(tenCents, twentyCents)),
  )

  // A realistic bill: three items at 19.99 with 21% VAT. `round` picks the
  // scale (digits after the point) at the moment you decide to round, not
  // at every step.
  const subtotal = BigDecimal.multiply(
    BigDecimal.fromStringUnsafe('19.99'),
    BigDecimal.fromNumberUnsafe(3),
  )
  const vat = BigDecimal.multiply(subtotal, BigDecimal.fromStringUnsafe('0.21'))
  yield* Console.log('subtotal:', BigDecimal.format(subtotal))
  yield* Console.log('exact VAT:', BigDecimal.format(vat))
  yield* Console.log(
    'VAT:',
    BigDecimal.format(BigDecimal.round(vat, { scale: 2 })),
  )

  // Parsing and dividing are safe here too.
  yield* Console.log(BigDecimal.fromString('19,99'))
  yield* Console.log(
    BigDecimal.divide(subtotal, BigDecimal.fromNumberUnsafe(0)),
  )

  // Plain numbers lose precision above 2^53: adding 1 does nothing. `bigint`
  // does not, and the `BigInt` module gives it the same safe helpers.
  yield* Console.log('as a number:', 9_007_199_254_740_992 + 1)
  const views = 9_007_199_254_740_992n
  yield* Console.log('as a bigint:', BigInt.sum(views, 1n))

  // Converting back is checked: `toNumber` returns `None` outside the safe
  // integer range, where a number could no longer count exactly.
  yield* Console.log(BigInt.toNumber(1_000n), BigInt.toNumber(views))
  yield* Console.log(
    BigInt.fromString('42'),
    Option.isNone(BigInt.fromString('4.2')),
  )
})
