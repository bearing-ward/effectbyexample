/**
 * @title Retrying with backoff
 * @difficulty intermediate
 * @summary A `Schedule` describes when to try again. Pass one to
 * `Effect.retry` to retry failures with exponential backoff, add jitter so
 * many clients do not retry in lockstep, cap the number of attempts, and
 * stop at once for errors that will never succeed.
 */

import { Clock, Console, Effect, Fiber, Random, Schedule, Schema } from 'effect'
import { TestClock } from 'effect/testing'

// The error carries the HTTP status, so the retry policy can look at it.
class GatewayError extends Schema.TaggedError<GatewayError>()('GatewayError', {
  status: Schema.Number,
}) {}

// A payment gateway that answers with the given status codes in order,
// then succeeds. Each attempt prints when it ran.
const makeGateway = (statuses: ReadonlyArray<number>) => {
  let attempt = 0
  return Effect.gen(function* () {
    const now = Math.round(yield* Clock.currentTimeMillis)
    const status = statuses[attempt++]
    yield* Console.log(`  attempt ${attempt} at ${now}ms: ${status ?? 200}`)
    if (status !== undefined) {
      return yield* new GatewayError({ status })
    }
    return 'charged'
  })
}

// The policy, built from small schedules:
// `exponential` waits 100ms, then 200ms, 400ms, and so on. `jittered`
// scales each delay by a random factor between 0.8 and 1.2. `recurs(4)`
// allows at most four retries. `Schedule.max` runs both together: it
// stops when either stops and uses the longer delay. `while` inspects the
// error and only continues for server errors.
const retryPolicy = Schedule.max([
  Schedule.exponential('100 millis').pipe(Schedule.jittered),
  Schedule.recurs(4),
]).pipe(
  Schedule.setInputType<GatewayError>(),
  Schedule.while(({ input }) => input.status >= 500),
)

// Each scenario runs in a fiber while the test clock jumps ahead, so the
// backoff delays pass instantly. `Random.withSeed` at the bottom makes the
// jitter repeatable.
const scenario = (label: string, statuses: ReadonlyArray<number>) =>
  Effect.gen(function* () {
    yield* Console.log(label)
    yield* TestClock.setTime(0)
    const fiber = yield* makeGateway(statuses).pipe(
      Effect.retry(retryPolicy),
      Effect.catchTag('GatewayError', (error) =>
        Effect.succeed(`gave up with ${error.status}`),
      ),
      Effect.forkChild,
    )
    yield* TestClock.adjust('10 seconds')
    yield* Console.log(`  result: ${yield* Fiber.join(fiber)}`)
  })

export const program = Effect.gen(function* () {
  // Two server errors, then success. The gaps grow, with jitter.
  yield* scenario('flaky gateway', [503, 503])

  // Always failing. One first attempt plus four retries, then the last
  // error comes back to us.
  yield* scenario('gateway down', [503, 503, 503, 503, 503, 503])

  // A 402 means the card was declined. Retrying cannot help, so `while`
  // stops the schedule after the first attempt.
  yield* scenario('card declined', [402])
}).pipe(Random.withSeed('retry-demo'), Effect.provide(TestClock.layer()))
