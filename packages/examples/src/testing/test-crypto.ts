/**
 * @title Deterministic crypto with TestCrypto
 * @difficulty intermediate
 * @summary Random ids make output impossible to assert on. `TestCrypto`
 * replaces the random parts of the `Crypto` service with a seeded generator,
 * so the same seed produces the same UUIDs, codes, and shuffles every run.
 */

import { BrowserCrypto } from '@effect/platform-browser'
import { Console, Crypto, Effect, Layer } from 'effect'
import { Hex } from 'effect/encoding'
import { TestClock, TestCrypto } from 'effect/testing'

// The code under test creates an order with a UUID, a short confirmation
// code, and a random free gift. It asks the `Crypto` service for randomness
// instead of calling `crypto.randomUUID()` directly.
const createOrder = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto
  const id = yield* crypto.randomUUIDv4()
  const code = Hex.encode(yield* crypto.randomBytes(3))
  const gifts = yield* crypto.randomShuffle(['mug', 'sticker', 'tote bag'])
  return { id, code, gift: gifts[0] }
})

// `TestCrypto.layer(seed)` wraps a real `Crypto`, here the Web Crypto one
// from `@effect/platform-browser`. Random operations come from the seed.
// TestCrypto is marked unstable.
const seeded = (seed: string) =>
  TestCrypto.layer(seed).pipe(Layer.provide(BrowserCrypto.layer))

export const program = Effect.gen(function* () {
  // Two runs with the same seed produce identical orders.
  const first = yield* Effect.provide(createOrder, seeded('checkout-test'))
  const second = yield* Effect.provide(createOrder, seeded('checkout-test'))
  yield* Console.log(first)
  yield* Console.log(JSON.stringify(first) === JSON.stringify(second))

  // A different seed gives a different, but still repeatable, sequence.
  yield* Console.log(yield* Effect.provide(createOrder, seeded('other-test')))

  // ULIDs and UUIDv7s also embed the current time. Add `TestClock` to pin
  // that part down too. The clock starts at 0, so the time prefix is zeros.
  const ulid = yield* Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    return yield* crypto.randomULID
  }).pipe(Effect.provide(Layer.merge(seeded('ulid-test'), TestClock.layer())))
  yield* Console.log(ulid)

  // Hashing is not random, so `digest` is passed through to the real
  // platform. The SHA-256 of empty input is the well-known `e3b0c442...`.
  const hash = yield* Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    return yield* crypto.digest('SHA-256', new Uint8Array(0))
  }).pipe(Effect.provide(seeded('checkout-test')))
  yield* Console.log(Hex.encode(hash))
})
