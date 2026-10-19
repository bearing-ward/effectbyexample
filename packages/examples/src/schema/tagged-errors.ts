/**
 * @title Errors as schemas
 * @difficulty intermediate
 * @summary `Schema.TaggedError` defines a typed error class. You can `yield*`
 * it to fail an Effect, catch it by tag, and, because it is a schema,
 * send it across the network and decode it on the other side.
 */

import { Console, Effect, Schema } from 'effect'

class UserNotFound extends Schema.TaggedError<UserNotFound>()('UserNotFound', {
  userId: Schema.String,
}) {}

class RateLimited extends Schema.TaggedError<RateLimited>()('RateLimited', {
  retryAfterSeconds: Schema.Number,
}) {}

// The possible failures appear in the type:
// `Effect<string, UserNotFound | RateLimited>`.
const findUser = (userId: string) =>
  Effect.gen(function* () {
    if (userId === 'busy') {
      return yield* new RateLimited({ retryAfterSeconds: 30 })
    }
    if (userId !== 'ada') {
      return yield* new UserNotFound({ userId })
    }
    return 'Ada Lovelace'
  })

export const program = Effect.gen(function* () {
  // `catchTags` handles each error by its tag. Remove a handler and the
  // remaining error shows up in the result type again.
  const lookups = yield* Effect.forEach(['ada', 'bob', 'busy'], (userId) =>
    findUser(userId).pipe(
      Effect.catchTags({
        UserNotFound: (error) => Effect.succeed(`no user ${error.userId}`),
        RateLimited: (error) =>
          Effect.succeed(`retry in ${error.retryAfterSeconds}s`),
      }),
    ),
  )
  yield* Console.log(lookups)

  // Errors are schemas, so they can be encoded to plain data and decoded
  // back into real instances.
  const wire = Schema.encodeSync(UserNotFound)(
    new UserNotFound({ userId: 'bob' }),
  )
  yield* Console.log(wire)

  const decoded = Schema.decodeUnknownSync(UserNotFound)(wire)
  yield* Console.log(decoded instanceof UserNotFound, decoded.userId)
})
