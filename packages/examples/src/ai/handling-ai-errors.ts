/**
 * @title Handling AI errors
 * @difficulty intermediate
 * @summary Every provider failure arrives as one `AiError` with a typed
 * `reason`: a rate limit, a bad API key, output that failed to decode, and
 * so on. Each reason knows whether it is worth retrying, so one retry policy
 * works for every provider.
 */

import { Console, Effect, Layer, Ref, Schema, Stream } from 'effect'
import { AiError, LanguageModel } from 'effect/ai'

// A fake provider that plays back HTTP statuses. `reasonFromHttpStatus` is
// the shared helper for turning a status into a reason: 429 becomes a
// `RateLimitError`, 401 an `AuthenticationError`, 500 an
// `InternalProviderError`.
const playback = (statuses: ReadonlyArray<number>) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    Effect.gen(function* () {
      const remaining = yield* Ref.make(statuses)
      return yield* LanguageModel.make({
        generateText: () =>
          Effect.gen(function* () {
            const [status = 200, ...rest] = yield* Ref.get(remaining)
            yield* Ref.set(remaining, rest)
            yield* Console.log(`provider answered ${status}`)
            if (status !== 200) {
              const reason = AiError.reasonFromHttpStatus({ status })
              return yield* AiError.make({
                module: 'FakeProvider',
                method: 'generateText',
                reason,
              })
            }
            return [{ type: 'text', text: 'Hello!' }] as const
          }),
        streamText: () => Stream.empty,
      })
    }),
  )

const greet = LanguageModel.generateText({ prompt: 'Say hello' }).pipe(
  // `isRetryable` is true for rate limits and server errors, false for an
  // invalid key. Real code would add a backoff `schedule` here.
  Effect.retry({ while: (error) => error.isRetryable, times: 3 }),
  Effect.map((response) => response.text),
)

// Wrap the reason in your own error to keep the details. `AiErrorReason` is
// a schema, so the error stays serializable.
class GreeterError extends Schema.TaggedError<GreeterError>()('GreeterError', {
  reason: AiError.AiErrorReason,
}) {}

export const program = Effect.gen(function* () {
  // Two rate limits, then success: the retry hides the hiccup.
  yield* Console.log(yield* greet.pipe(Effect.provide(playback([429, 429]))))

  // A bad key is not retryable, so it fails on the first try. `catchReason`
  // handles one reason of a tagged error and lets the others through.
  const message = yield* greet.pipe(
    Effect.catchReason('AiError', 'AuthenticationError', (reason) =>
      Effect.succeed(`fix your key: ${reason.kind}`),
    ),
    Effect.provide(playback([401])),
  )
  yield* Console.log(message)

  // `times: 3` allows three retries, four attempts in all. When the server
  // keeps failing, the last error comes through and we map it to our own.
  const error = yield* greet.pipe(
    Effect.mapError((error) => new GreeterError({ reason: error.reason })),
    Effect.flip,
    Effect.provide(playback([500, 500, 500, 500])),
  )
  yield* Console.log(`${error._tag}: ${error.reason._tag}`)
})
