/**
 * @title Hashing and random IDs
 * @difficulty beginner
 * @summary The `Crypto` service computes SHA digests and makes secure random
 * values: bytes, numbers, and UUIDs. Because it is a service, tests can swap
 * in a seeded version that returns the same "random" values on every run.
 */

// The browser implementation uses the Web Crypto API, which Node, Bun, and
// Deno also provide. `NodeServices.layer` includes a Node implementation.
import { BrowserCrypto } from '@effect/platform-browser'
import { Console, Crypto, Effect } from 'effect'
import { Hex } from 'effect/encoding'
import { TestCrypto } from 'effect/testing'

export const program = Effect.gen(function* () {
  const crypto = yield* Crypto.Crypto

  // `digest` hashes bytes. The same input always gives the same hash, which
  // makes it useful for cache keys and integrity checks. The text is ASCII,
  // so each character becomes one byte.
  const body = Uint8Array.from('{"order":42,"total":1999}', (char) =>
    char.charCodeAt(0),
  )
  const hash = yield* crypto.digest('SHA-256', body)
  yield* Console.log(Hex.encode(hash))

  // Random values differ on every run, so here we print only their shape:
  // a UUIDv4 is 36 characters with a 4 in the version position.
  const id = yield* crypto.randomUUIDv4()
  yield* Console.log(id.length, id[14])
  const roll = yield* crypto.randomIntBetween(1, 6)
  yield* Console.log(roll >= 1 && roll <= 6)

  // Operations validate their input. A negative size fails with a
  // `PlatformError` whose reason is `BadArgument`.
  const invalid = yield* crypto.randomBytes(-1).pipe(Effect.flip)
  yield* Console.log(invalid.reason._tag)

  // `TestCrypto.layer` replaces the randomness with a seeded generator and
  // keeps the real digest. Code that asks for `Crypto` gets repeatable
  // values, so tests can assert on them. Each new layer with the same seed
  // starts the same sequence.
  const sample = Effect.gen(function* () {
    const crypto = yield* Crypto.Crypto
    return [
      yield* crypto.randomUUIDv4(),
      yield* crypto.randomShuffle(['ada', 'grace', 'linus', 'margaret']),
    ]
  })
  const first = yield* sample.pipe(
    Effect.provide(TestCrypto.layer('demo-seed')),
  )
  const second = yield* sample.pipe(
    Effect.provide(TestCrypto.layer('demo-seed')),
  )
  yield* Console.log(first)
  yield* Console.log(JSON.stringify(first) === JSON.stringify(second))
}).pipe(Effect.provide(BrowserCrypto.layer))
