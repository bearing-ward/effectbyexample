/**
 * @title Non-empty arrays
 * @difficulty beginner
 * @summary Some operations only make sense when there is at least one
 * element: the first item, the maximum, the latest reading. A
 * `NonEmptyReadonlyArray` records that guarantee in the type, so those
 * operations return a value instead of an `Option` or `undefined`.
 */

import { Array, Console, Effect, Option, Order } from 'effect'

interface Reading {
  readonly sensor: string
  readonly celsius: number
}

// `NonEmptyReadonlyArray<A>` is the tuple type `readonly [A, ...A[]]`.
// TypeScript checks that at least one element is present.
const kitchen: Array.NonEmptyReadonlyArray<Reading> = [
  { sensor: 'kitchen', celsius: 21.5 },
  { sensor: 'kitchen', celsius: 23.0 },
  { sensor: 'kitchen', celsius: 22.1 },
]

const byCelsius = Order.mapInput(Order.Number, (r: Reading) => r.celsius)

// A function that needs a reading to work with can say so in its
// parameter. `max` and `headNonEmpty` only accept non-empty arrays, and
// they return the element directly.
const summarize = (readings: Array.NonEmptyReadonlyArray<Reading>) =>
  `first ${Array.headNonEmpty(readings).celsius}, ` +
  `max ${Array.max(readings, byCelsius).celsius}`

export const program = Effect.gen(function* () {
  yield* Console.log(summarize(kitchen))

  // `map` keeps the non-empty type, so the result can go straight into
  // another function that needs a non-empty array.
  const fahrenheit = Array.map(kitchen, (r) => (r.celsius * 9) / 5 + 32)
  yield* Console.log(Array.headNonEmpty(fahrenheit))

  // Data from outside usually arrives as an ordinary array. On a plain
  // array, `head` cannot promise an element, so it returns an `Option`.
  const garage: ReadonlyArray<Reading> = []
  yield* Console.log(Option.isNone(Array.head(garage)))

  // To get from an ordinary array to a non-empty one, check it. After
  // `isReadonlyArrayNonEmpty` returns true, TypeScript narrows the type.
  for (const readings of [kitchen, garage]) {
    if (Array.isReadonlyArrayNonEmpty(readings)) {
      yield* Console.log(summarize(readings))
    } else {
      yield* Console.log('no readings yet')
    }
  }

  // `match` does the same check as an expression, with one branch for
  // each case.
  const label = Array.match(garage, {
    onEmpty: () => 'garage: offline',
    onNonEmpty: (readings) => `garage: ${summarize(readings)}`,
  })
  yield* Console.log(label)

  // Constructors that always produce elements return non-empty arrays:
  // `Array.make`, `Array.append`, and `Array.of` among them.
  const withNew = Array.append(garage, { sensor: 'garage', celsius: 12.4 })
  yield* Console.log(summarize(withNew))
})
