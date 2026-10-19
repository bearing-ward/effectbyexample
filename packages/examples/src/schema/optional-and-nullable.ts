/**
 * @title Optional and nullable fields
 * @difficulty beginner
 * @summary Say exactly what "missing" means: a key that may be absent, a key
 * that may hold `undefined`, or a value that may be `null`.
 */

import { Console, Effect, Schema } from 'effect'

const Profile = Schema.Struct({
  username: Schema.String,

  // `optionalKey` means the key may be left out entirely. Its type is
  // `bio?: string`.
  bio: Schema.optionalKey(Schema.String),

  // `optional` also allows the key to be present with the value `undefined`.
  // Its type is `website?: string | undefined`.
  website: Schema.optional(Schema.String),

  // `NullOr` keeps the key required but lets the value be `null`, which is
  // common in database rows and JSON APIs.
  avatarUrl: Schema.NullOr(Schema.String),
})

const decode = Schema.decodeUnknownSync(Profile)

export const program = Effect.gen(function* () {
  // Only the required keys.
  yield* Console.log(decode({ username: 'ada', avatarUrl: null }))

  // Every key filled in.
  yield* Console.log(
    decode({
      username: 'grace',
      bio: 'Wrote the first compiler',
      website: 'https://example.com',
      avatarUrl: 'https://example.com/grace.png',
    }),
  )

  // `null` is not a missing key, so leaving out `avatarUrl` still fails.
  yield* Console.log(Schema.is(Profile)({ username: 'linus' }))
})
