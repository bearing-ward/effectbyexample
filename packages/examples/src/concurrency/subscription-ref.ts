/**
 * @title Watching state with SubscriptionRef
 * @difficulty intermediate
 * @summary A `SubscriptionRef` is a `Ref` you can watch. Its `changes`
 * stream emits the current value and then every new one, so a dashboard or
 * a cache can react to state changes instead of polling for them.
 */

import {
  Console,
  Deferred,
  Effect,
  Fiber,
  Stream,
  SubscriptionRef,
} from 'effect'

type Deployment = { readonly version: string; readonly status: string }

export const program = Effect.gen(function* () {
  const deployment = yield* SubscriptionRef.make<Deployment>({
    version: 'v1',
    status: 'live',
  })

  // A watcher subscribes to `changes`. We use a `Deferred` to know when it
  // has received the first value and is listening, instead of guessing
  // with a sleep.
  const listening = yield* Deferred.make<void>()
  const watcher = yield* SubscriptionRef.changes(deployment).pipe(
    Stream.tap(() => Deferred.succeed(listening, undefined)),
    // Stop after the first value that matches, including that value.
    Stream.takeUntil((d) => d.version === 'v2' && d.status === 'live'),
    Stream.map((d) => `${d.version} ${d.status}`),
    Stream.runCollect,
    Effect.forkChild,
  )
  yield* Deferred.await(listening)

  // Updates work like `Ref`: `set`, `update`, `modify`, and so on. Each one
  // is published to every watcher.
  yield* SubscriptionRef.set(deployment, {
    version: 'v2',
    status: 'rolling out',
  })
  yield* SubscriptionRef.update(deployment, (d) => ({ ...d, status: 'live' }))

  // The watcher saw the starting value and both changes, then stopped on
  // its own once v2 went live.
  yield* Console.log(yield* Fiber.join(watcher))

  // Reading it directly gives the latest value, like any `Ref`.
  yield* Console.log(yield* SubscriptionRef.get(deployment))
})
