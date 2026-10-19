/**
 * @title Rate limiting
 * @difficulty intermediate
 * @summary `RateLimiter` counts requests per key in a shared store, so every
 * process that uses the same store enforces one limit together. When a key
 * runs out, you choose: fail the request, or learn how long to wait.
 */

import { Console, Duration, Effect, Layer } from 'effect'
import { RateLimiter } from 'effect/persistence'
import { TestClock } from 'effect/testing'

export const program = Effect.gen(function* () {
  const limiter = yield* RateLimiter.RateLimiter

  // Each consume takes one token from the key's budget: three requests per
  // minute per user. `remaining` says how many are left.
  const callApi = (user: string) =>
    limiter
      .consume({ key: `api:${user}`, limit: 3, window: '1 minute' })
      .pipe(Effect.map((result) => `${user}: ok, ${result.remaining} left`))

  // By default an exhausted key fails with a `RateLimiterError` whose reason
  // is `RateLimitExceeded`. `retryAfter` says when to try again.
  const attempt = (user: string) =>
    callApi(user).pipe(
      Effect.catchReason('RateLimiterError', 'RateLimitExceeded', (reason) =>
        Effect.succeed(
          `${user}: limited, retry in ${Duration.toSeconds(reason.retryAfter)}s`,
        ),
      ),
    )

  for (let i = 0; i < 4; i++) {
    yield* Console.log(yield* attempt('ada'))
  }

  // Keys are independent, so another user still has a full budget.
  yield* Console.log(yield* attempt('grace'))

  // Once the window has passed, the key has a fresh budget. The test clock
  // moves time forward without waiting.
  yield* TestClock.adjust('1 minute')
  yield* Console.log(yield* attempt('ada'))

  // With `onExceeded: 'delay'` the limiter never fails. It reports how long
  // to wait instead. A token bucket refills smoothly: two per second means a
  // new token every 500 milliseconds, so the third request should wait 500
  // milliseconds and the fourth a full second. `RateLimiter.sleep` does the
  // waiting for you.
  const delays: Array<number> = []
  for (let i = 0; i < 4; i++) {
    const result = yield* limiter.consume({
      key: 'exports',
      algorithm: 'token-bucket',
      onExceeded: 'delay',
      limit: 2,
      window: '1 second',
    })
    delays.push(Duration.toMillis(result.delay))
  }
  yield* Console.log(delays)
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      // The memory store works within one process. `layerStoreRedis` shares
      // the counts between processes.
      RateLimiter.layer.pipe(Layer.provide(RateLimiter.layerStoreMemory)),
      // A test clock keeps the output the same on every run.
      TestClock.layer(),
    ),
  ),
)
