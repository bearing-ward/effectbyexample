/**
 * @title Catching errors by tag
 * @difficulty beginner
 * @summary Tagged errors let you handle exactly the failures you mean to.
 * `catchTag` handles one, `catchTags` handles several, `catch` handles the
 * rest, and `mapError` translates errors without recovering. The type tracks
 * what is still unhandled after each step.
 */

import { Console, Effect, Schema } from 'effect'

class UserNotFound extends Schema.TaggedError<UserNotFound>()('UserNotFound', {
  userId: Schema.String,
}) {}

class RateLimited extends Schema.TaggedError<RateLimited>()('RateLimited', {
  retryAfterSeconds: Schema.Number,
}) {}

class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  'Unauthorized',
  {},
) {}

// Loading a profile can fail in three ways:
// `Effect<string, UserNotFound | RateLimited | Unauthorized>`.
const loadProfile = (userId: string) =>
  Effect.gen(function* () {
    if (userId === 'u-404') return yield* new UserNotFound({ userId })
    if (userId === 'u-429')
      return yield* new RateLimited({ retryAfterSeconds: 30 })
    if (userId === 'u-401') return yield* new Unauthorized()
    return `profile of ${userId}`
  })

// `catchTag` handles one tag. The result type drops `UserNotFound`:
// `Effect<string, RateLimited | Unauthorized>`.
const withGuest = (userId: string) =>
  loadProfile(userId).pipe(
    Effect.catchTag('UserNotFound', (error) =>
      Effect.succeed(`guest profile (no ${error.userId})`),
    ),
  )

// `catchTags` takes one handler per tag. Each handler sees its own error
// type, so `error.retryAfterSeconds` is available only where it exists.
const withAllHandled = (userId: string): Effect.Effect<string> =>
  loadProfile(userId).pipe(
    Effect.catchTags({
      UserNotFound: () => Effect.succeed('guest profile'),
      RateLimited: (error) =>
        Effect.succeed(`try again in ${error.retryAfterSeconds}s`),
      Unauthorized: () => Effect.succeed('please sign in'),
    }),
  )

// `mapError` changes the error without handling it. Here an HTTP layer turns
// domain errors into status codes. `Effect.catch` then handles whatever is
// left, whatever its tag.
const statusCodes = {
  UserNotFound: 404,
  RateLimited: 429,
  Unauthorized: 401,
} as const

const asHttp = (userId: string) =>
  loadProfile(userId).pipe(
    Effect.mapError((error) => statusCodes[error._tag]),
    Effect.catch((status) => Effect.succeed(`HTTP ${status}`)),
  )

export const program = Effect.gen(function* () {
  yield* Console.log(yield* withGuest('u-1'))
  yield* Console.log(yield* withGuest('u-404'))

  // `withGuest` did not handle `RateLimited`, so it still fails. We look at
  // the remaining error with `Effect.flip`.
  const left = yield* Effect.flip(withGuest('u-429'))
  yield* Console.log('still failing with', left._tag)

  for (const userId of ['u-404', 'u-429', 'u-401']) {
    yield* Console.log(
      yield* withAllHandled(userId),
      '|',
      yield* asHttp(userId),
    )
  }
})
