/**
 * @title Predicates and booleans
 * @difficulty beginner
 * @summary A predicate is a function that answers yes or no. The `Predicate`
 * module has ready-made type guards for `unknown` values and combinators to
 * build bigger rules from small ones. `Boolean` and `Symbol` add a few helpers
 * for their own types.
 */

import { Boolean, Console, Effect, Predicate, Symbol } from 'effect'

interface Order {
  readonly totalCents: number
  readonly country: string
  readonly giftWrap: boolean
}

// Small rules, each easy to test on its own.
const isLarge: Predicate.Predicate<Order> = (order) =>
  order.totalCents >= 10_000
const isDomestic: Predicate.Predicate<Order> = (order) => order.country === 'NL'
const wantsGiftWrap: Predicate.Predicate<Order> = (order) => order.giftWrap

// `and`, `or`, and `not` combine predicates into new ones.
const freeShipping = Predicate.and(isDomestic, isLarge)
const needsManualPacking = Predicate.or(
  wantsGiftWrap,
  Predicate.not(isDomestic),
)

export const program = Effect.gen(function* () {
  const orders: ReadonlyArray<Order> = [
    { totalCents: 12_000, country: 'NL', giftWrap: false },
    { totalCents: 4_000, country: 'NL', giftWrap: true },
    { totalCents: 15_000, country: 'BE', giftWrap: false },
  ]
  for (const order of orders) {
    yield* Console.log(
      `${order.country} ${order.totalCents}:`,
      `free shipping ${freeShipping(order)},`,
      `manual packing ${needsManualPacking(order)}`,
    )
  }

  // Guards narrow `unknown`. Use them instead of hand-written `typeof`
  // checks. `hasProperty` checks a key exists, `isTagged` checks `_tag`, and
  // `Symbol.isSymbol` is the guard for symbols, on its own module.
  const describe = (input: unknown): string => {
    if (Predicate.isString(input)) return `string: ${input}`
    if (Predicate.isNumber(input)) return `number: ${input}`
    if (Predicate.isTagged(input, 'Coupon')) return 'coupon'
    if (Predicate.hasProperty(input, 'sku')) return `sku: ${String(input.sku)}`
    if (Symbol.isSymbol(input)) return `symbol: ${input.description}`
    return 'something else'
  }
  const inputs: ReadonlyArray<unknown> = [
    'mug',
    42,
    { _tag: 'Coupon', code: 'SPRING10' },
    { sku: 'lamp' },
    globalThis.Symbol.for('internal'),
    null,
  ]
  for (const input of inputs) {
    yield* Console.log(describe(input))
  }

  // `Boolean.match` picks a branch from a boolean, and `every` and `some`
  // fold a list of them.
  const checks = orders.map(freeShipping)
  yield* Console.log(
    Boolean.match(Boolean.some(checks), {
      onTrue: () => 'some orders ship free',
      onFalse: () => 'no free shipping',
    }),
  )
  yield* Console.log('all ship free:', Boolean.every(checks))

  // `xor` is true when exactly one side is true: here, gift wrap or abroad,
  // but not both.
  yield* Console.log(
    'one special handling:',
    orders.map((order) => Boolean.xor(order.giftWrap, order.country !== 'NL')),
  )
})
