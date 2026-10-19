/**
 * @title Caching lookups
 * @difficulty intermediate
 * @summary A `Cache` remembers the results of an effectful lookup by key.
 * Callers asking for the same key at the same time share one lookup,
 * entries expire after a time to live, and the cache stays within a fixed
 * capacity.
 */

import { Cache, Console, Effect, Ref } from 'effect'
import { TestClock } from 'effect/testing'

export const program = Effect.gen(function* () {
  // The lookup stands in for a slow call to a pricing service. We count
  // how many times it really runs.
  const calls = yield* Ref.make(0)
  const fetchPrice = (sku: string) =>
    Effect.gen(function* () {
      yield* Ref.update(calls, (n) => n + 1)
      yield* Console.log(`  lookup ${sku}`)
      return sku.length * 100
    })

  // `Cache.make` takes the lookup, a capacity and an optional time to live.
  const prices = yield* Cache.make({
    lookup: fetchPrice,
    capacity: 2,
    timeToLive: '5 minutes',
  })

  // Three requests for the same key at once run a single lookup.
  const first = yield* Effect.all(
    [
      Cache.get(prices, 'mug'),
      Cache.get(prices, 'mug'),
      Cache.get(prices, 'mug'),
    ],
    { concurrency: 'unbounded' },
  )
  yield* Console.log('mug x3:', first, 'lookups:', yield* Ref.get(calls))

  // Later reads within the time to live are served from memory.
  yield* Console.log('mug again:', yield* Cache.get(prices, 'mug'))

  // Once the entry is older than five minutes, the next read looks it up
  // again. The test clock moves time forward without waiting.
  yield* TestClock.adjust('6 minutes')
  yield* Console.log('mug later:', yield* Cache.get(prices, 'mug'))

  // With a capacity of 2, adding a third key evicts the least recently
  // used entry, here `mug`.
  yield* Cache.get(prices, 'teapot')
  yield* Cache.get(prices, 'kettle')
  yield* Console.log('size:', yield* Cache.size(prices))
  yield* Console.log('keys:', [...(yield* Cache.keys(prices))])

  // `invalidate` removes an entry on purpose, for example after a price
  // change, so the next read fetches the new value.
  yield* Cache.invalidate(prices, 'kettle')
  yield* Console.log('kettle cached:', yield* Cache.has(prices, 'kettle'))
  yield* Console.log('total lookups:', yield* Ref.get(calls))
}).pipe(Effect.provide(TestClock.layer()))
