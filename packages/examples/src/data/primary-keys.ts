/**
 * @title Stable string keys with PrimaryKey
 * @difficulty intermediate
 * @summary Caches, stores, and message queues need a string to identify a
 * value. `PrimaryKey` is a tiny protocol for that: a value implements one
 * method that returns its key, and any code can read it with
 * `PrimaryKey.value`.
 */

import { Console, Data, Effect, PrimaryKey } from 'effect'

// A request for a price quote. The key is built from the fields that decide
// the answer. The `requestedBy` field is left out on purpose: two customers
// asking for the same quote should share one cache entry.
class QuoteRequest
  extends Data.Class<{
    readonly sku: string
    readonly country: string
    readonly requestedBy: string
  }>
  implements PrimaryKey.PrimaryKey
{
  [PrimaryKey.symbol](): string {
    return `quote:${this.sku}:${this.country}`
  }
}

// A cache that works for any value with a primary key. It stores entries by
// the key string, so it never compares objects by reference.
const makeCache = <K extends PrimaryKey.PrimaryKey, V>() => {
  const entries = new Map<string, V>()
  return {
    getOrCompute: (key: K, compute: () => V) =>
      Effect.gen(function* () {
        const id = PrimaryKey.value(key)
        const cached = entries.get(id)
        if (cached !== undefined) {
          yield* Console.log(`hit  ${id}`)
          return cached
        }
        yield* Console.log(`miss ${id}`)
        const value = compute()
        entries.set(id, value)
        return value
      }),
  }
}

export const program = Effect.gen(function* () {
  const quotes = makeCache<QuoteRequest, number>()
  const priceFor = (request: QuoteRequest) =>
    quotes.getOrCompute(request, () => (request.country === 'NL' ? 1200 : 1450))

  // Ada and Grace ask for the same quote. The second request is a hit even
  // though it is a different object with a different `requestedBy`.
  yield* priceFor(
    new QuoteRequest({ sku: 'mug', country: 'NL', requestedBy: 'ada' }),
  )
  yield* priceFor(
    new QuoteRequest({ sku: 'mug', country: 'NL', requestedBy: 'grace' }),
  )
  yield* priceFor(
    new QuoteRequest({ sku: 'mug', country: 'DE', requestedBy: 'ada' }),
  )

  // `isPrimaryKey` checks an unknown value before you rely on it.
  const inputs: ReadonlyArray<unknown> = [
    new QuoteRequest({ sku: 'lamp', country: 'BE', requestedBy: 'ada' }),
    { sku: 'lamp' },
  ]
  for (const input of inputs) {
    yield* Console.log(
      PrimaryKey.isPrimaryKey(input)
        ? PrimaryKey.value(input)
        : 'no primary key',
    )
  }

  // Effect's own modules use the same protocol. Persistence, cluster
  // messages, and `HashRing` nodes are identified by their primary key.
})
