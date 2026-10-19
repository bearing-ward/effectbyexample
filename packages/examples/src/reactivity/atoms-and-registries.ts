/**
 * @title Atoms and registries
 * @difficulty beginner
 * @summary An atom describes one piece of state, or how to compute it from
 * other atoms. An `AtomRegistry` holds the current values, so the same atoms
 * can back many independent registries, such as one per test or per request.
 */

import { Console, Effect } from 'effect'
import { Atom, AtomRegistry } from 'effect/reactivity'

// `Atom.make` with a plain value creates a writable atom. The atom itself
// stores nothing: it is a description that a registry reads and writes.
// The reactivity modules are marked `@stability unstable`.
const cartItems = Atom.make([
  { name: 'Coffee beans', cents: 1450, quantity: 1 },
  { name: 'Paper filters', cents: 399, quantity: 2 },
])

export const program = Effect.gen(function* () {
  // `Atom.make` with a function creates a derived, read-only atom. Calling
  // `get(atom)` reads another atom and records it as a dependency. The
  // counter shows when the function actually runs.
  let computations = 0
  const cartTotal = Atom.make((get) => {
    computations++
    return get(cartItems).reduce(
      (sum, item) => sum + item.cents * item.quantity,
      0,
    )
  })

  // `Atom.map` is a shorthand for a derived atom that reads one atom.
  const itemCount = Atom.map(cartItems, (items) => items.length)

  // `AtomRegistry.make` creates an empty registry. Values live here.
  const registry = AtomRegistry.make()

  yield* Console.log(`total: ${registry.get(cartTotal)} cents`)
  yield* Console.log(`items: ${registry.get(itemCount)}`)

  // While nothing changes, reading again reuses the cached value.
  registry.get(cartTotal)
  yield* Console.log(`computed ${computations} time(s)`)

  // `update` writes a new value from the old one. Derived atoms that depend
  // on it are marked stale. Nobody is watching them, so they wait for the
  // next read before they recompute.
  registry.update(cartItems, (items) => [
    ...items,
    { name: 'Grinder', cents: 4900, quantity: 1 },
  ])
  yield* Console.log(`computed ${computations} time(s)`)
  yield* Console.log(`total: ${registry.get(cartTotal)} cents`)
  yield* Console.log(`items: ${registry.get(itemCount)}`)
  yield* Console.log(`computed ${computations} time(s)`)

  // A second registry has its own values for the very same atoms. It starts
  // from the atom's initial value, untouched by the update above.
  const other = AtomRegistry.make()
  yield* Console.log(`other registry total: ${other.get(cartTotal)} cents`)

  // `set` replaces the value outright.
  other.set(cartItems, [])
  yield* Console.log(`other registry total: ${other.get(cartTotal)} cents`)

  registry.dispose()
  other.dispose()
})
