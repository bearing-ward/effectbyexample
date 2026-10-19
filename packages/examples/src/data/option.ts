/**
 * @title Option
 * @difficulty beginner
 * @summary An `Option` is a value that may be missing: `Some(value)` or
 * `None`. It makes "maybe absent" part of the type, and comes with helpers to
 * transform, combine, and fall back without a chain of `if` checks.
 */

import { Console, Effect, Option, pipe } from 'effect'

interface Customer {
  readonly name: string
  readonly referredBy?: string
}

const customers = new Map<string, Customer>([
  ['c-1', { name: 'Ada', referredBy: 'c-2' }],
  ['c-2', { name: 'Grace' }],
])

// `fromNullishOr` turns `undefined` or `null` into `None`, and anything else
// into `Some`. The return type tells callers the customer may not exist.
const findCustomer = (id: string): Option.Option<Customer> =>
  Option.fromNullishOr(customers.get(id))

export const program = Effect.gen(function* () {
  yield* Console.log(findCustomer('c-1'))
  yield* Console.log(findCustomer('c-9'))

  // `map` changes the value inside a `Some` and leaves `None` alone.
  // `getOrElse` unwraps with a fallback.
  const greeting = (id: string) =>
    pipe(
      findCustomer(id),
      Option.map((customer) => `Hello, ${customer.name}`),
      Option.getOrElse(() => 'Hello, guest'),
    )
  yield* Console.log(greeting('c-1'))
  yield* Console.log(greeting('c-9'))

  // `flatMap` chains steps that may each be missing. Ada's referrer exists,
  // Grace has none, so her chain stops at `None`.
  const referrerName = (id: string) =>
    pipe(
      findCustomer(id),
      Option.flatMap((customer) => Option.fromNullishOr(customer.referredBy)),
      Option.flatMap(findCustomer),
      Option.map((referrer) => referrer.name),
    )
  yield* Console.log('referrer of c-1:', Option.getOrNull(referrerName('c-1')))
  yield* Console.log('referrer of c-2:', Option.getOrNull(referrerName('c-2')))

  // `match` handles both cases explicitly.
  for (const id of ['c-2', 'c-9']) {
    yield* Console.log(
      Option.match(findCustomer(id), {
        onSome: (customer) => `${id} is ${customer.name}`,
        onNone: () => `${id} is unknown`,
      }),
    )
  }

  // `filter` turns a `Some` into `None` when the value fails a check. Grace
  // exists, but her name is not longer than five letters.
  const longName = Option.filter(findCustomer('c-2'), (c) => c.name.length > 5)
  yield* Console.log('long name:', longName)

  // `Effect.fromOption` moves into effect code: `None` becomes a
  // `NoSuchElementError` failure. `Effect.option` turns it back.
  const missing = yield* Effect.fromOption(findCustomer('c-9')).pipe(
    Effect.map((customer) => customer.name),
    Effect.option,
  )
  yield* Console.log('from an effect:', missing)
})
