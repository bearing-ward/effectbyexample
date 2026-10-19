/**
 * @title HashMap and HashSet
 * @difficulty intermediate
 * @summary A JavaScript `Map` compares object keys by reference, so two
 * equal-looking keys are two different entries. `HashMap` and `HashSet`
 * compare keys with `Equal.equals`, which in Effect 4 compares plain
 * objects and arrays by their contents. They are also immutable: every
 * update returns a new collection.
 */

import { Console, Effect, HashMap, HashSet, Option, pipe } from 'effect'

// A cart line is identified by product and size together, so the key is
// an object rather than a string.
interface LineKey {
  readonly sku: string
  readonly size: string
}

export const program = Effect.gen(function* () {
  // With a native `Map`, a freshly built key never finds the entry, even
  // though it has the same fields.
  const native = new Map<LineKey, number>()
  native.set({ sku: 'tee', size: 'M' }, 1)
  yield* Console.log(native.get({ sku: 'tee', size: 'M' }))

  // `HashMap` hashes the key's contents, so any key with the same fields
  // finds the entry.
  const cart = HashMap.make([{ sku: 'tee', size: 'M' }, 1])
  yield* Console.log(HashMap.get(cart, { sku: 'tee', size: 'M' }))

  // Adding to the cart uses `modifyAt`, which receives the current value
  // as an `Option` and returns the new one. Repeated items merge into one
  // line instead of piling up as duplicates.
  const addToCart = (key: LineKey) =>
    HashMap.modifyAt(key, (quantity: Option.Option<number>) =>
      Option.some(Option.getOrElse(quantity, () => 0) + 1),
    )

  const updated = pipe(
    cart,
    addToCart({ sku: 'tee', size: 'M' }),
    addToCart({ sku: 'tee', size: 'L' }),
    addToCart({ sku: 'tee', size: 'M' }),
  )
  yield* Console.log(`lines: ${HashMap.size(updated)}`)
  yield* Console.log(HashMap.get(updated, { sku: 'tee', size: 'M' }))

  // The original map did not change. Each update produced a new map that
  // shares most of its structure with the old one.
  yield* Console.log(HashMap.get(cart, { sku: 'tee', size: 'M' }))

  // `HashSet` uses the same equality. Here it records which warehouse
  // shelves have been counted, using `[aisle, shelf]` pairs.
  const counted = HashSet.make([3, 1], [3, 2], [7, 4])
  yield* Console.log(HashSet.has(counted, [3, 2]))
  yield* Console.log(HashSet.size(HashSet.add(counted, [3, 1])))

  // Set operations compare by content too.
  const planned = HashSet.make([3, 1], [3, 2], [7, 4], [9, 9])
  yield* Console.log(Array.from(HashSet.difference(planned, counted)))

  // One rule: never mutate an object after using it as a key. Its hash is
  // computed once and cached, so after the change neither the old nor the
  // new contents find the entry.
  const capKey = { sku: 'cap', size: 'S' }
  const caps = HashMap.make([capKey, 1])
  capKey.size = 'L'
  yield* Console.log(HashMap.has(caps, { sku: 'cap', size: 'S' }))
  yield* Console.log(HashMap.has(caps, { sku: 'cap', size: 'L' }))
})
