/**
 * @title Consistent hashing with HashRing
 * @difficulty advanced
 * @summary When keys are spread over several servers, adding a server
 * should not reshuffle every key. A `HashRing` assigns each key to a node
 * so that adding or removing a node only moves the keys that must move.
 * Effect's cluster sharding uses it internally. `HashRing` is marked
 * unstable.
 */

import { Console, Effect, Hash, HashRing, PrimaryKey } from 'effect'

// Ring nodes need a stable identity, given by `PrimaryKey`. The ring
// hashes this string, never the object itself.
class CacheServer implements PrimaryKey.PrimaryKey {
  constructor(readonly name: string) {}
  [PrimaryKey.symbol]() {
    return this.name
  }
}

const sessions = Array.from({ length: 1000 }, (_, i) => `session-${i}`)

// The naive approach: hash the key and take it modulo the number of
// servers. It spreads keys evenly, but its answer depends on the count.
const moduloOwner = (servers: ReadonlyArray<CacheServer>, key: string) =>
  servers[Math.abs(Hash.string(key)) % servers.length]!.name

export const program = Effect.gen(function* () {
  const servers = ['cache-a', 'cache-b', 'cache-c'].map(
    (name) => new CacheServer(name),
  )

  // `HashRing.make` creates an empty ring. `addMany` places each node at
  // many points on the ring; `get` walks to the next point after the key's
  // hash. Note that the ring is mutable: `addMany` updates it in place.
  const ring = HashRing.addMany(HashRing.make<CacheServer>(), servers)
  const ringOwner = (key: string) => HashRing.get(ring, key)!.name

  // Keys spread roughly evenly over the three servers.
  const counts = new Map<string, number>()
  for (const key of sessions) {
    const owner = ringOwner(key)
    counts.set(owner, (counts.get(owner) ?? 0) + 1)
  }
  yield* Console.log(Object.fromEntries(counts))

  // Remember who owns what, then add a fourth server to both schemes.
  const ringBefore = sessions.map(ringOwner)
  const moduloBefore = sessions.map((key) => moduloOwner(servers, key))

  const bigger = [...servers, new CacheServer('cache-d')]
  HashRing.add(ring, bigger[3]!)

  // With modulo, most keys now land on a different server, so most cached
  // sessions are lost at once. With the ring, only the keys that the new
  // server takes over move, about a quarter of them.
  const moved = (
    before: ReadonlyArray<string>,
    after: (key: string) => string,
  ) => sessions.filter((key, i) => after(key) !== before[i]).length

  yield* Console.log(
    `modulo moved ${moved(moduloBefore, (key) => moduloOwner(bigger, key))}`,
  )
  yield* Console.log(`ring moved ${moved(ringBefore, ringOwner)}`)

  // Every moved key went to the new server. No key moved between the
  // servers that were already there.
  const movedTo = new Set(
    sessions
      .filter((key, i) => ringOwner(key) !== ringBefore[i])
      .map(ringOwner),
  )
  yield* Console.log(Array.from(movedTo))

  // Removing a server hands only its keys to the others. Removing cache-d
  // again puts every key back with the server that owned it at the start.
  HashRing.remove(ring, bigger[3]!)
  yield* Console.log(
    `after removing cache-d: ${moved(ringBefore, ringOwner)} differ`,
  )
})
