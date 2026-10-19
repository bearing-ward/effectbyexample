/**
 * @title Refreshable values with Resource
 * @difficulty intermediate
 * @summary A `Resource` loads a value once, keeps it for fast reads, and
 * reloads it when you ask or on a schedule. If a reload fails, readers keep
 * getting the last good value, which suits things like exchange rates or
 * feature flags fetched from another service.
 */

import { Console, Effect, Ref, Resource, Schedule, Schema } from 'effect'
import { TestClock } from 'effect/testing'

class RatesUnavailable extends Schema.TaggedError<RatesUnavailable>()(
  'RatesUnavailable',
  {},
) {}

export const program = Effect.gen(function* () {
  // A fake rates service: each call returns a newer rate, and we can make
  // it fail on demand.
  const version = yield* Ref.make(0)
  const down = yield* Ref.make(false)
  const fetchRate = Effect.gen(function* () {
    if (yield* Ref.get(down)) {
      return yield* new RatesUnavailable()
    }
    const n = yield* Ref.updateAndGet(version, (v) => v + 1)
    yield* Console.log(`fetch #${n}`)
    return { eurToUsd: 1 + n / 100 }
  })

  // `Resource.manual` fetches once now. Reads after that are served from
  // memory: three reads, one fetch.
  const rates = yield* Resource.manual(fetchRate)
  for (let i = 0; i < 3; i++) {
    yield* Console.log('read', yield* Resource.get(rates))
  }

  // `Resource.refresh` fetches again and replaces the stored value.
  yield* Resource.refresh(rates)
  yield* Console.log('after refresh', yield* Resource.get(rates))

  // A failed refresh returns the error and keeps the old value in place.
  yield* Ref.set(down, true)
  const refreshed = yield* Resource.refresh(rates).pipe(
    Effect.as('refreshed'),
    Effect.catchTag('RatesUnavailable', () => Effect.succeed('refresh failed')),
  )
  yield* Console.log(refreshed, yield* Resource.get(rates))
  yield* Ref.set(down, false)

  // `Resource.auto` refreshes on a schedule in a background fiber that
  // lives as long as the resource's scope. Creating it fetches once, and the
  // schedule's first refresh runs straight away; after that it refreshes
  // every hour. The test clock lets the hours pass without waiting.
  yield* Effect.gen(function* () {
    const hourly = yield* Resource.auto(fetchRate, Schedule.spaced('1 hour'))
    yield* Console.log('created', yield* Resource.get(hourly))
    yield* TestClock.adjust('1 hour')
    yield* Console.log('an hour later', yield* Resource.get(hourly))
  }).pipe(Effect.scoped, Effect.provide(TestClock.layer()))
}).pipe(
  // `Resource.manual` also needs a scope, which owns the stored value.
  Effect.scoped,
)
