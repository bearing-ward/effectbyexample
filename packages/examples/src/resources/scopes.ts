/**
 * @title Working with a Scope directly
 * @difficulty intermediate
 * @summary A `Scope` is the list of cleanups that belong together.
 * `Effect.scoped` handles it for you, but you can create, extend and close a
 * scope yourself when a resource's lifetime does not match a single block of
 * code, such as a connection that lives across several requests.
 */

import { Console, Effect, Exit, Scope } from 'effect'

const connect = (name: string) =>
  Effect.acquireRelease(Effect.as(Console.log(`connect ${name}`), name), () =>
    Console.log(`disconnect ${name}`),
  )

export const program = Effect.gen(function* () {
  // `Scope.make` creates a scope that we close by hand.
  const session = yield* Scope.make()

  // `Scope.provide` runs an effect that needs a scope inside ours. The
  // effect finishes, but its resource stays open because the scope does.
  const cache = yield* connect('cache').pipe(Scope.provide(session))
  yield* Console.log(`still using ${cache}`)

  // A child scope is closed on its own, or together with its parent.
  const request = yield* Scope.fork(session)
  yield* connect('search').pipe(Scope.provide(request))
  yield* Scope.addFinalizer(request, Console.log('flush request log'))

  // Closing the child runs its finalizers and leaves the parent alone.
  yield* Scope.close(request, Exit.void)
  yield* Console.log('request done, session still open')

  // A second child that we never close ourselves.
  const background = yield* Scope.fork(session)
  yield* connect('metrics').pipe(Scope.provide(background))

  // Closing the session closes everything still in it, in reverse order:
  // the open child scope first, then the cache.
  yield* Scope.close(session, Exit.void)
  yield* Console.log('session closed')

  // `Scope.use` is the one-shot form: run an effect in a scope, then close
  // the scope with the effect's result.
  const reportScope = yield* Scope.make()
  yield* connect('reports').pipe(Effect.asVoid, Scope.use(reportScope))
})
