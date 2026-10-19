/**
 * @title Hydration
 * @difficulty advanced
 * @summary With server rendering, the server loads data into atoms, renders
 * HTML, and sends the state along. `Hydration.dehydrate` encodes the state of
 * atoms marked `Atom.serializable`, and `Hydration.hydrate` preloads it into
 * the browser's registry, so the client starts where the server stopped.
 */

import { Console, Effect, Schema } from 'effect'
import { AsyncResult, Atom, AtomRegistry, Hydration } from 'effect/reactivity'

class Product extends Schema.Class<Product>('Product')({
  sku: Schema.String,
  name: Schema.String,
  cents: Schema.Number,
}) {}

export const program = Effect.gen(function* () {
  // Counts how often the product is loaded, across server and client.
  let loads = 0

  // `Atom.serializable` gives an atom a stable key and a schema. The key
  // matches the atom on both sides, since the server and the browser each
  // build their own atom objects. The schema encodes the value to JSON.
  // `Hydration` is marked `@stability unstable`.
  const product = Atom.make(
    Effect.sync(() => {
      loads++
      return new Product({ sku: 'tea-01', name: 'Green tea', cents: 899 })
    }),
  ).pipe(
    Atom.serializable({
      key: 'product:tea-01',
      schema: AsyncResult.Schema({ success: Product }),
    }),
  )
  const quantity = Atom.make(1).pipe(
    Atom.serializable({ key: 'quantity', schema: Schema.Number }),
  )
  // Atoms without `serializable` stay on the server.
  const renderCount = Atom.make(0)

  // On the server: mount the atoms the page renders, so they stay alive,
  // wait for the data, then dehydrate the registry.
  const server = AtomRegistry.make()
  server.mount(product)
  server.mount(quantity)
  yield* AtomRegistry.getResult(server, product)
  server.set(quantity, 3)
  server.set(renderCount, 1)
  const state = Hydration.dehydrate(server)

  // The dehydrated state is plain data, ready to embed in the HTML. Each
  // entry has a key and an encoded value. Entries and results also carry
  // timestamps, which we hide to keep the output stable.
  const html = JSON.stringify(state)
  const hideTimestamp = (key: string, value: unknown) =>
    key === 'timestamp' ? undefined : value
  for (const entry of Hydration.toValues(state)) {
    yield* Console.log(entry.key, JSON.stringify(entry.value, hideTimestamp))
  }
  server.dispose()

  // In the browser: parse the state and hydrate a fresh registry before
  // any atom is read.
  const client = AtomRegistry.make()
  Hydration.hydrate(client, JSON.parse(html))

  // The atoms start with the server's values. The product is already a
  // `Success`, so the browser does not load it again.
  const result = client.get(product)
  yield* Console.log(
    AsyncResult.isSuccess(result)
      ? `${result.value.name} x ${client.get(quantity)}`
      : result._tag,
  )
  yield* Console.log(`product loads: ${loads}`)
  yield* Console.log(`render count on the client: ${client.get(renderCount)}`)
  client.dispose()
})
