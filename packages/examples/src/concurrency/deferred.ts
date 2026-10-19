/**
 * @title One-shot signals with Deferred
 * @difficulty intermediate
 * @summary A `Deferred` is a value that does not exist yet. Any number of
 * fibers can wait for it, and it can be completed exactly once, with a
 * success or a failure. It is the Effect version of a promise you resolve by
 * hand.
 */

import { Console, Deferred, Effect, Fiber } from 'effect'

export const program = Effect.gen(function* () {
  // A deferred session token. Requests that arrive before sign-in finishes
  // wait for it instead of signing in again.
  const token = yield* Deferred.make<string, string>()

  // `Deferred.await` suspends until the deferred is completed.
  const request = (path: string) =>
    Effect.gen(function* () {
      const value = yield* Deferred.await(token)
      return `GET ${path} (${value})`
    })

  const waiting = yield* Effect.forkChild(
    Effect.all([request('/orders'), request('/invoices')], {
      concurrency: 'unbounded',
    }),
  )

  // The deferred is still empty, so both requests are waiting.
  yield* Effect.yieldNow
  yield* Console.log('signed in yet?', yield* Deferred.isDone(token))

  // `Deferred.succeed` completes it and wakes every waiter. It returns
  // `true` because this call set the value.
  yield* Console.log('first complete:', yield* Deferred.succeed(token, 'tok_1'))
  yield* Console.log(yield* Fiber.join(waiting))

  // A deferred completes only once. Later attempts return `false` and
  // change nothing, and anyone who awaits now gets the value at once.
  yield* Console.log(
    'second complete:',
    yield* Deferred.succeed(token, 'tok_2'),
  )
  yield* Console.log(yield* request('/profile'))

  // Completing with a failure makes every waiter fail with that error.
  const refused = yield* Deferred.make<string, string>()
  yield* Deferred.fail(refused, 'invalid password')
  const result = yield* Deferred.await(refused).pipe(
    Effect.catch((error) => Effect.succeed(`sign-in failed: ${error}`)),
  )
  yield* Console.log(result)
})
