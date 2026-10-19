/**
 * @title Retrying failures
 * @difficulty beginner
 * @summary Some failures go away if you try again. `Effect.retry` reruns an
 * effect after a typed failure. Limit how many times it tries, and retry only
 * the errors that are worth retrying.
 */

import { Console, Effect, Ref, Schema } from 'effect'

class ServiceUnavailable extends Schema.TaggedError<ServiceUnavailable>()(
  'ServiceUnavailable',
  {},
) {}

class InvalidAddress extends Schema.TaggedError<InvalidAddress>()(
  'InvalidAddress',
  { address: Schema.String },
) {}

// A shipping quote service that is down for the first `outages` calls.
const makeQuoteService = (outages: number) =>
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    const quote = (address: string) =>
      Effect.gen(function* () {
        const call = yield* Ref.updateAndGet(calls, (n) => n + 1)
        yield* Console.log(`  attempt ${call}`)
        if (address === '') return yield* new InvalidAddress({ address })
        if (call <= outages) return yield* new ServiceUnavailable()
        return 'shipping: 4.99'
      })
    return { quote }
  })

export const program = Effect.gen(function* () {
  // `retry` runs the effect again each time it fails, up to `times` extra
  // attempts. Two outages, three retries allowed: the third attempt works.
  const flaky = yield* makeQuoteService(2)
  yield* Console.log(
    yield* flaky.quote('1 Main St').pipe(Effect.retry({ times: 3 })),
  )

  // When every attempt fails, the last error comes through as usual.
  const down = yield* makeQuoteService(10)
  const gaveUp = yield* down
    .quote('1 Main St')
    .pipe(Effect.retry({ times: 2 }), Effect.flip)
  yield* Console.log('gave up with', gaveUp._tag)

  // Retrying a bad address only wastes calls. `while` decides, per error,
  // whether another attempt makes sense.
  const healthy = yield* makeQuoteService(0)
  const invalid = yield* healthy.quote('').pipe(
    Effect.retry({
      times: 3,
      while: (error) => error._tag === 'ServiceUnavailable',
    }),
    Effect.flip,
  )
  yield* Console.log('stopped at once with', invalid._tag)

  // These retries happen back to back. Real code usually waits between
  // attempts; pass a `schedule` such as `Schedule.exponential` for that.
})
