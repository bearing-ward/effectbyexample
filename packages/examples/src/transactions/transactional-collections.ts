/**
 * @title Transactional collections
 * @difficulty intermediate
 * @summary `TxHashMap`, `TxHashSet`, and `TxChunk` are a map, a set, and a list
 * whose updates join the surrounding transaction. Changes to all three commit
 * together, so they never disagree with each other.
 */

import {
  Chunk,
  Console,
  Effect,
  Option,
  Schema,
  TxChunk,
  TxHashMap,
  TxHashSet,
} from 'effect'

class OutOfStock extends Schema.TaggedError<OutOfStock>()('OutOfStock', {
  sku: Schema.String,
}) {}

export const program = Effect.gen(function* () {
  // Stock levels by SKU, the set of orders already reserved, and an audit
  // log. Each one is built on `TxRef`s under the hood.
  const stock = yield* TxHashMap.make(['mug', 3], ['shirt', 1])
  const reserved = yield* TxHashSet.empty<string>()
  const audit = yield* TxChunk.empty<string>()

  // Reserving an order touches all three collections. Wrapping the steps in
  // `Effect.tx` makes them one unit: either every SKU is decremented, the
  // order is marked, and the log grows, or none of it happens.
  const reserve = (orderId: string, skus: ReadonlyArray<string>) =>
    Effect.tx(
      Effect.gen(function* () {
        if (yield* TxHashSet.has(reserved, orderId)) {
          return 'already reserved'
        }
        for (const sku of skus) {
          const left = yield* TxHashMap.get(stock, sku)
          if (Option.getOrElse(left, () => 0) === 0) {
            return yield* new OutOfStock({ sku })
          }
          yield* TxHashMap.modify(stock, sku, (n) => n - 1)
        }
        yield* TxHashSet.add(reserved, orderId)
        yield* TxChunk.append(audit, `${orderId}: ${skus.join(', ')}`)
        return 'reserved'
      }),
    ).pipe(Effect.catchTag('OutOfStock', (e) => Effect.succeed(`no ${e.sku}`)))

  const report = Effect.gen(function* () {
    const mugs = yield* TxHashMap.get(stock, 'mug')
    const shirts = yield* TxHashMap.get(stock, 'shirt')
    yield* Console.log(
      `  stock: mug=${Option.getOrThrow(mugs)} shirt=${Option.getOrThrow(shirts)}`,
      `reserved=${yield* TxHashSet.size(reserved)}`,
    )
  })

  yield* Console.log(`order-1 ${yield* reserve('order-1', ['mug', 'shirt'])}`)
  yield* report

  // The second order wants a mug and a shirt. The mug is decremented first,
  // then the shirt check fails. The failure rolls the mug back too.
  yield* Console.log(`order-2 ${yield* reserve('order-2', ['mug', 'shirt'])}`)
  yield* report

  // Retrying the first order is harmless, thanks to the reserved set.
  yield* Console.log(`order-1 ${yield* reserve('order-1', ['mug', 'shirt'])}`)

  // `TxChunk.get` returns an immutable `Chunk` snapshot of the log.
  const log = yield* TxChunk.get(audit)
  yield* Console.log(Chunk.toReadonlyArray(log))
})
