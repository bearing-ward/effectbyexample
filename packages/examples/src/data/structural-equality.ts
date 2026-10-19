/**
 * @title Structural equality with Data, Equal, and Hash
 * @difficulty beginner
 * @summary JavaScript compares objects by reference, so two identical prices
 * are "different". `Equal.equals` compares by contents instead, `Data`
 * classes opt in automatically, and `Hash` keeps hash-based collections
 * consistent with that equality.
 */

import { Console, Data, Effect, Equal, Hash, HashSet } from 'effect'

// A `Data.Class` gets structural equality and hashing for free. Two instances
// with the same fields are equal.
class Money extends Data.Class<{
  readonly cents: number
  readonly currency: string
}> {}

// `Data.TaggedClass` adds a `_tag` field, which is handy for events and
// union members.
class ItemAdded extends Data.TaggedClass('ItemAdded')<{
  readonly sku: string
  readonly price: Money
}> {}

// An entity is the same entity if its id matches, even when other fields
// change. Implement `Equal.symbol` and `Hash.symbol` to say so. Values that
// are equal must have the same hash, so hash only the id.
class Customer {
  constructor(
    readonly id: string,
    readonly email: string,
  ) {}
  [Equal.symbol](that: unknown): boolean {
    return that instanceof Customer && that.id === this.id
  }
  [Hash.symbol](): number {
    return Hash.string(this.id)
  }
}

export const program = Effect.gen(function* () {
  const a = new Money({ cents: 500, currency: 'EUR' })
  const b = new Money({ cents: 500, currency: 'EUR' })

  // `===` asks "same object?". `Equal.equals` asks "same contents?".
  yield* Console.log('===:', a === b)
  yield* Console.log('Equal.equals:', Equal.equals(a, b))
  yield* Console.log('same hash:', Hash.hash(a) === Hash.hash(b))

  // Equality goes all the way down, through nested `Data` values.
  const first = new ItemAdded({ sku: 'mug', price: a })
  const again = new ItemAdded({ sku: 'mug', price: b })
  yield* Console.log('events equal:', Equal.equals(first, again))

  // In Effect 4, plain objects and arrays compare structurally too.
  yield* Console.log(
    'plain objects:',
    Equal.equals({ sku: 'mug' }, { sku: 'mug' }),
  )
  yield* Console.log('arrays:', Equal.equals(['mug', 'lamp'], ['mug', 'lamp']))

  // A native `Set` uses `===`, so it keeps both prices. `HashSet` uses
  // `Hash` and `Equal`, so it keeps one.
  yield* Console.log('Set size:', new Set([a, b]).size)
  yield* Console.log('HashSet size:', HashSet.size(HashSet.make(a, b)))

  // The custom rule: same id, different email, still the same customer.
  const before = new Customer('c-1', 'ada@old.example')
  const after = new Customer('c-1', 'ada@new.example')
  yield* Console.log('same customer:', Equal.equals(before, after))
})
