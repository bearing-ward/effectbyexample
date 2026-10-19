/**
 * @title Persisted caches
 * @difficulty intermediate
 * @summary `PersistedCache` remembers the results of an expensive lookup in
 * two places: a fast in-memory cache and a persisted store. A fresh process
 * finds earlier results in the store instead of doing the work again.
 */

import { Console, Effect, Exit, Ref, Schema } from 'effect'
import { Persistable, PersistedCache, Persistence } from 'effect/persistence'

class Weather extends Schema.Class<Weather>('Weather')({
  city: Schema.String,
  celsius: Schema.Int,
}) {}

class CityNotFound extends Schema.TaggedError<CityNotFound>()('CityNotFound', {
  city: Schema.String,
}) {}

// Cache keys are `Persistable` requests, so the cache knows how to store
// both the result and the error.
class GetWeather extends Persistable.Class<{ payload: { city: string } }>()(
  'GetWeather',
  {
    primaryKey: ({ city }) => city,
    success: Weather,
    error: CityNotFound,
  },
) {}

export const program = Effect.gen(function* () {
  // Count calls to the slow lookup, standing in for a remote API.
  const calls = yield* Ref.make(0)
  const lookup = (request: GetWeather) =>
    Effect.gen(function* () {
      yield* Ref.update(calls, (n) => n + 1)
      if (request.city === 'Atlantis') {
        return yield* new CityNotFound({ city: request.city })
      }
      return new Weather({ city: request.city, celsius: 21 })
    })

  // Each process builds its own cache, but they share the persisted store.
  // `timeToLive` can depend on the outcome: remember a forecast for an hour
  // and a missing city for a day.
  const makeCache = PersistedCache.make(lookup, {
    storeId: 'weather',
    timeToLive: (exit) => (Exit.isSuccess(exit) ? '1 hour' : '1 day'),
  })

  // First process: two lookups for Lisbon run the work once, and the
  // failure for Atlantis is cached like a success.
  const first = yield* makeCache
  yield* first.get(new GetWeather({ city: 'Lisbon' }))
  yield* first.get(new GetWeather({ city: 'Lisbon' }))
  yield* first.get(new GetWeather({ city: 'Atlantis' })).pipe(Effect.ignore)
  yield* Console.log(`calls after first process: ${yield* Ref.get(calls)}`)

  // A second cache starts with an empty memory, like a restarted process.
  // Both answers come from the persisted store.
  const second = yield* makeCache
  const lisbon = yield* second.get(new GetWeather({ city: 'Lisbon' }))
  const atlantis = yield* second
    .get(new GetWeather({ city: 'Atlantis' }))
    .pipe(Effect.flip)
  yield* Console.log(lisbon, atlantis._tag)
  yield* Console.log(`calls after second process: ${yield* Ref.get(calls)}`)

  // `invalidate` removes an entry from both layers, so the next `get` runs
  // the lookup again.
  yield* second.invalidate(new GetWeather({ city: 'Lisbon' }))
  yield* second.get(new GetWeather({ city: 'Lisbon' }))
  yield* Console.log(`calls after invalidate: ${yield* Ref.get(calls)}`)
}).pipe(Effect.scoped, Effect.provide(Persistence.layerMemory))
