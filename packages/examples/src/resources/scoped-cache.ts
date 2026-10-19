/**
 * @title Caching resources with ScopedCache
 * @difficulty advanced
 * @summary A plain `Cache` stores values. A `ScopedCache` stores resources:
 * each entry gets its own scope, and the cache closes that scope when the
 * entry is evicted or invalidated, or when the cache itself goes away.
 */

import { Console, Effect, ScopedCache } from 'effect'

// One client per region, opened as a scoped resource. Opening is slow, so
// we want to reuse clients, but each one holds a socket that must close.
const openRegionClient = (region: string) =>
  Effect.acquireRelease(
    Effect.as(Console.log(`connect ${region}`), {
      region,
      fetch: (path: string) => `${region}${path}`,
    }),
    () => Console.log(`disconnect ${region}`),
  )

export const program = Effect.gen(function* () {
  // The lookup may use `Scope`. Its resources belong to the entry, not to
  // the caller of `get`.
  const clients = yield* ScopedCache.make({
    lookup: openRegionClient,
    capacity: 2,
  })

  // The first `get` connects. The second reuses the cached client, and the
  // client stays open after `get` returns.
  const eu = yield* ScopedCache.get(clients, 'eu-west')
  yield* Console.log(eu.fetch('/orders'))
  yield* ScopedCache.get(clients, 'eu-west')

  yield* ScopedCache.get(clients, 'us-east')

  // A third region exceeds the capacity. The least recently used entry is
  // evicted, and its client disconnects.
  yield* ScopedCache.get(clients, 'ap-south')
  yield* Console.log('cached:', [...(yield* ScopedCache.keys(clients))])

  // Invalidating an entry closes its client too.
  yield* ScopedCache.invalidate(clients, 'us-east')
  yield* Console.log('cached:', [...(yield* ScopedCache.keys(clients))])

  yield* Console.log('shutting down')
}).pipe(
  // The cache lives in this scope. Closing it disconnects what is left.
  Effect.scoped,
)
