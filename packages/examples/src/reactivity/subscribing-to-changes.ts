/**
 * @title Subscribing to changes
 * @difficulty beginner
 * @summary A user interface needs to know when state changes, not only what
 * it is. `subscribe` runs a callback each time an atom's value changes, and
 * `Atom.batch` groups several writes into one notification.
 */

import { Console, Effect } from 'effect'
import { Atom, AtomRegistry } from 'effect/reactivity'

const firstName = Atom.make('Ada')
const lastName = Atom.make('Lovelace')
const fullName = Atom.make((get) => `${get(firstName)} ${get(lastName)}`)
const initials = Atom.make((get) => `${get(firstName)[0]}${get(lastName)[0]}`)

export const program = Effect.gen(function* () {
  // The registry is also an Effect service. `AtomRegistry.layer` builds one
  // and disposes it when the layer's scope closes.
  const registry = yield* AtomRegistry.AtomRegistry
  const seen: Array<string> = []

  // `subscribe` returns a function that cancels the subscription.
  // `immediate: true` also delivers the current value straight away.
  const stop = registry.subscribe(fullName, (name) => seen.push(name), {
    immediate: true,
  })

  // Each write that changes `fullName` notifies the subscriber once.
  registry.set(firstName, 'Grace')
  registry.set(lastName, 'Hopper')
  yield* Console.log(seen)

  // Writing two atoms one after the other would show the half updated
  // name "Alan Hopper" to subscribers. `Atom.batch` delays notifications
  // until the whole update is done.
  seen.length = 0
  Atom.batch(() => {
    registry.set(firstName, 'Alan')
    registry.set(lastName, 'Turing')
  })
  yield* Console.log(seen)

  // Subscribers only hear about real changes. Writing the same value again
  // produces no notification.
  seen.length = 0
  registry.set(lastName, 'Turing')
  yield* Console.log(`notifications after a no-op write: ${seen.length}`)
  stop()

  // The `Atom` module also has Effect versions of `get`, `set`, and
  // `update` that use the `AtomRegistry` service from the context. This is
  // handy inside services that should not hold a registry themselves.
  yield* Atom.set(firstName, 'Katherine')
  yield* Atom.update(lastName, (name) => name.replace('Turing', 'Johnson'))
  yield* Console.log(yield* Atom.get(initials))
}).pipe(Effect.provide(AtomRegistry.layer))
