/**
 * @title Lazy iterables
 * @difficulty intermediate
 * @summary The `Iterable` module has the same helpers as `Array`, but it
 * does no work until something reads the result. That lets you describe a
 * pipeline over a huge or endless sequence and pay only for the elements you
 * actually consume. `NonEmptyIterable` marks an iterable that has at least
 * one element.
 */

import {
  Chunk,
  Console,
  Effect,
  Iterable,
  NonEmptyIterable,
  pipe,
} from 'effect'

export const program = Effect.gen(function* () {
  // Count how many invoices the pipeline looks at. This is only here to
  // make the laziness visible.
  let inspected = 0

  // `Iterable.range` with no end produces invoice numbers forever. An
  // array could not hold this, but an iterable only needs the next value.
  // The `map` step stands in for looking up how late each invoice is.
  const overdue = pipe(
    Iterable.range(1000),
    Iterable.map((id) => {
      inspected++
      return { id, daysLate: (id * 7) % 45 }
    }),
    Iterable.filter((invoice) => invoice.daysLate > 30),
    Iterable.take(3),
  )

  // Building the pipeline did nothing yet.
  yield* Console.log(`inspected before reading: ${inspected}`)

  // Reading it runs each step one element at a time, and stops as soon as
  // `take(3)` has its three invoices.
  const firstThree = Array.from(overdue, (i) => `#${i.id}`)
  yield* Console.log(firstThree)
  yield* Console.log(`inspected after reading: ${inspected}`)

  // The result is a description, not a cache. Reading it again repeats the
  // work. Convert it to an array once if you need the values twice.
  Array.from(overdue)
  yield* Console.log(`inspected after reading twice: ${inspected}`)

  // `head` reads one element, so it also stops early. It returns an
  // `Option` because a plain iterable may be empty.
  yield* Console.log(
    pipe(
      Iterable.range(1),
      Iterable.filter((n) => n % 17 === 0),
      Iterable.head,
    ),
  )

  // `NonEmptyIterable` is a type that says "at least one element". Effect
  // collections that are known to be non-empty, such as the `Chunk` from
  // `Chunk.make`, satisfy it. `unprepend` can then split off the first
  // element without an `Option`, and leaves an iterator for the rest.
  const queue: NonEmptyIterable.NonEmptyIterable<string> = Chunk.make(
    'pack',
    'label',
    'ship',
  )
  const [next, rest] = NonEmptyIterable.unprepend(queue)
  yield* Console.log(`next: ${next}`)
  yield* Console.log(Array.from({ [Symbol.iterator]: () => rest }))
})
