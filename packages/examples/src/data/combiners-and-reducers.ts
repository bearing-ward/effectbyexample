/**
 * @title Combining values with Combiner and Reducer
 * @difficulty intermediate
 * @summary A `Combiner` says how to merge two values into one. A `Reducer` is
 * a combiner plus a starting value, so it can fold a whole list, including an
 * empty one. Build them for small pieces, then assemble them into a reducer
 * for a whole record.
 */

import {
  Array,
  Combiner,
  Console,
  Effect,
  Number,
  Order,
  Reducer,
  Struct,
  UndefinedOr,
} from 'effect'

interface DailySales {
  readonly orders: number
  readonly revenueCents: number
  readonly largestOrderCents: number | undefined
  readonly regions: ReadonlyArray<string>
}

const days: ReadonlyArray<DailySales> = [
  {
    orders: 12,
    revenueCents: 48_000,
    largestOrderCents: 9_000,
    regions: ['NL'],
  },
  { orders: 0, revenueCents: 0, largestOrderCents: undefined, regions: [] },
  {
    orders: 7,
    revenueCents: 31_500,
    largestOrderCents: 12_000,
    regions: ['BE', 'DE'],
  },
]

export const program = Effect.gen(function* () {
  // `Combiner.make` builds a combiner from a binary function. Ready-made
  // ones cover common choices, like `max` for a given `Order`.
  const longerName = Combiner.make((a: string, b: string) =>
    b.length > a.length ? b : a,
  )
  yield* Console.log(longerName.combine('mug', 'kettle'))
  yield* Console.log(Combiner.max(Order.Number).combine(9_000, 12_000))

  // A `Reducer` adds `initialValue`, which is also the answer for an empty
  // list. Modules ship common ones, like `Number.ReducerSum`.
  const sum = Reducer.make((a: number, b: number) => a + b, 0)
  yield* Console.log(sum.combineAll([1, 2, 3]), sum.combineAll([]))
  yield* Console.log(Number.ReducerSum.combineAll([48_000, 31_500]))

  // A largest order does not exist on a day without orders. `UndefinedOr`
  // lifts a combiner over `A | undefined`: missing values are skipped, and an
  // empty list gives `undefined` instead of a made-up number.
  const largest = UndefinedOr.makeReducer(Combiner.max(Order.Number))
  yield* Console.log(largest.combineAll([9_000, undefined, 12_000]))
  yield* Console.log(largest.combineAll([]))

  // `Struct.makeReducer` builds a reducer for a record from one reducer per
  // field. Summarizing a week is now one call.
  const weekly = Struct.makeReducer<DailySales>({
    orders: Number.ReducerSum,
    revenueCents: Number.ReducerSum,
    largestOrderCents: largest,
    regions: Array.getReadonlyReducerConcat(),
  })
  yield* Console.log(weekly.combineAll(days))

  // With no days at all, every field falls back to its initial value.
  yield* Console.log(weekly.combineAll([]))
})
