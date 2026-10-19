/**
 * @title Async atoms and AsyncResult
 * @difficulty intermediate
 * @summary An atom built from an Effect does not hold the value directly.
 * It holds an `AsyncResult`: `Initial` while the first load runs, then
 * `Success` or `Failure`. A `waiting` flag marks a refresh in progress, so a
 * screen can keep showing old data while new data loads.
 */

import { Console, Effect, Option, Queue, Schema } from 'effect'
import { AsyncResult, Atom, AtomRegistry } from 'effect/reactivity'

class ProfileNotFound extends Schema.TaggedError<ProfileNotFound>()(
  'ProfileNotFound',
  { userId: Schema.String },
) {}

interface Profile {
  readonly name: string
}

// `AsyncResult.builder` matches each state in turn, the way a component
// decides what to render. `onErrorTag` handles one typed failure by its
// tag. `onSuccess` also receives the result, so it can check `waiting`.
const render = (result: AsyncResult.AsyncResult<Profile, ProfileNotFound>) =>
  AsyncResult.builder(result)
    .onInitial(() => 'loading...')
    .onErrorTag('ProfileNotFound', (error, failure) => {
      // A failure remembers the last success, so the old data is still there.
      const previous = AsyncResult.value(failure).pipe(
        Option.match({ onNone: () => 'none', onSome: (p) => p.name }),
      )
      return `no profile for ${error.userId}, last known: ${previous}`
    })
    .onSuccess((profile, { waiting }) =>
      waiting ? `${profile.name} (refreshing)` : profile.name,
    )
    .orElse(() => 'something went wrong')

export const program = Effect.gen(function* () {
  // A stand-in for the network: each load waits for the next reply we push.
  const replies = yield* Queue.unbounded<Profile | ProfileNotFound>()

  // `Atom.make` with an Effect creates an atom of type
  // `Atom<AsyncResult<Profile, ProfileNotFound>>`. The registry runs the
  // effect the first time the atom is read. `AsyncResult` is marked
  // `@stability unstable`, like the other reactivity modules.
  const profile = Atom.make(
    Queue.take(replies).pipe(
      Effect.flatMap((reply) =>
        reply instanceof ProfileNotFound
          ? Effect.fail(reply)
          : Effect.succeed(reply),
      ),
    ),
  )

  const registry = AtomRegistry.make()
  // `mount` keeps the atom alive, the way an on-screen component would.
  // Without it, an unused atom may be cleaned up and its fiber interrupted.
  const unmount = registry.mount(profile)

  yield* Console.log(render(registry.get(profile)))

  // `AtomRegistry.getResult` waits until the atom leaves `Initial`, then
  // succeeds or fails with the atom's own value or error.
  yield* Queue.offer(replies, { name: 'Ada Lovelace' })
  yield* AtomRegistry.getResult(registry, profile)
  yield* Console.log(render(registry.get(profile)))

  // `refresh` reruns the effect. The atom keeps its old value and sets
  // `waiting` until the new reply arrives.
  registry.refresh(profile)
  yield* Console.log(render(registry.get(profile)))

  // This time the server says the user is gone. `suspendOnWaiting` makes
  // `getResult` wait for the refresh to finish rather than return the old
  // value. `Effect.exit` keeps the expected failure from stopping us.
  yield* Queue.offer(replies, new ProfileNotFound({ userId: 'u-1' }))
  yield* Effect.exit(
    AtomRegistry.getResult(registry, profile, { suspendOnWaiting: true }),
  )
  yield* Console.log(render(registry.get(profile)))

  unmount()
  registry.dispose()
})
