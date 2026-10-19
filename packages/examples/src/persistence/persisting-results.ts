/**
 * @title Persisting results
 * @difficulty intermediate
 * @summary A `Persistable` request carries a primary key and schemas for its
 * success and error. `Persistence` uses them to save the outcome of the
 * request, success or failure, and to read it back later, even after a
 * restart.
 */

import { Console, Effect, Exit, Layer, Schema } from 'effect'
import { KeyValueStore, Persistable, Persistence } from 'effect/persistence'

class Rate extends Schema.Class<Rate>('Rate')({
  from: Schema.String,
  to: Schema.String,
  value: Schema.Finite,
}) {}

class UnknownCurrency extends Schema.TaggedError<UnknownCurrency>()(
  'UnknownCurrency',
  { code: Schema.String },
) {}

// The request describes what was asked. `primaryKey` names the stored
// entry, and the schemas say how to encode and decode its outcome.
class GetRate extends Persistable.Class<{
  payload: { from: string; to: string }
}>()('GetRate', {
  primaryKey: ({ from, to }) => `${from}-${to}`,
  success: Rate,
  error: UnknownCurrency,
}) {}

export const program = Effect.gen(function* () {
  // `Persistence` hands out named stores. Entries can expire; this store
  // keeps them for an hour.
  const persistence = yield* Persistence.Persistence
  const rates = yield* persistence.make({
    storeId: 'rates',
    timeToLive: () => '1 hour',
  })

  // Stores save an `Exit`, so a failure can be remembered as well as a
  // success.
  const eurToUsd = new GetRate({ from: 'EUR', to: 'USD' })
  const eurToXyz = new GetRate({ from: 'EUR', to: 'XYZ' })
  yield* rates.set(
    eurToUsd,
    Exit.succeed(new Rate({ from: 'EUR', to: 'USD', value: 1.08 })),
  )
  yield* rates.set(eurToXyz, Exit.fail(new UnknownCurrency({ code: 'XYZ' })))

  // Reading decodes the stored outcome back into typed values. A request
  // that was never stored reads as `undefined`.
  const usd = yield* rates.get(eurToUsd)
  if (usd !== undefined && Exit.isSuccess(usd)) {
    yield* Console.log(usd.value)
  }
  const xyz = yield* rates.get(eurToXyz)
  if (xyz !== undefined && Exit.isFailure(xyz)) {
    yield* Console.log(Exit.findErrorOption(xyz))
  }
  yield* Console.log(yield* rates.get(new GetRate({ from: 'EUR', to: 'JPY' })))

  // Underneath is a `KeyValueStore`. Each entry is the JSON-encoded `Exit`
  // and its expiry time, under the store id plus the primary key.
  const kvs = yield* KeyValueStore.KeyValueStore
  const raw = yield* kvs.get('ratesEUR-USD')
  const [encodedExit, expiresAt] = JSON.parse(raw ?? '[]')
  yield* Console.log(encodedExit, typeof expiresAt)
}).pipe(
  Effect.scoped,
  // `layerKvs` keeps entries in a `KeyValueStore`. Swap the memory store for
  // `layerFileSystem` or `layerStorage` and they survive a restart. There are
  // also SQL and Redis backends.
  Effect.provide(
    Layer.provideMerge(Persistence.layerKvs, KeyValueStore.layerMemory),
  ),
)
