/**
 * @title Calling Effect from other code
 * @difficulty intermediate
 * @summary Most apps are not Effect all the way down: a web framework or a
 * job runner calls your code with plain callbacks. A `ManagedRuntime` builds
 * your layers once and gives that code `runPromise` and friends, with the
 * services already provided.
 */

import { Console, Context, Effect, Layer, ManagedRuntime, Schema } from 'effect'

class OrderNotFound extends Schema.TaggedError<OrderNotFound>()(
  'OrderNotFound',
  { id: Schema.String },
) {}

// The store records its lifecycle in a plain array, so the non-Effect code
// below can show when it opened and closed.
class Orders extends Context.Service<
  Orders,
  { readonly status: (id: string) => Effect.Effect<string, OrderNotFound> }
>()('app/Orders') {
  static readonly layer = (lifecycle: Array<string>) =>
    Layer.effect(
      Orders,
      Effect.acquireRelease(
        Effect.sync(() => {
          lifecycle.push('store opened')
          const statuses = new Map([['o-1', 'shipped']])
          return Orders.of({
            status: (id) => {
              const status = statuses.get(id)
              return status === undefined
                ? Effect.fail(new OrderNotFound({ id }))
                : Effect.succeed(status)
            },
          })
        }),
        () => Effect.sync(() => lifecycle.push('store closed')),
      ),
    )
}

// Everything in this function is ordinary async code, like the startup and
// route handlers of an Express or Hono app.
async function main(): Promise<Array<string>> {
  const lifecycle: Array<string> = []

  // Build the runtime once, at startup. The layer is built on first use
  // and shared by every call after that.
  const runtime = ManagedRuntime.make(Orders.layer(lifecycle))

  // `runtime.runPromise` runs an Effect that needs `Orders` and returns a
  // Promise. A typed failure would reject the Promise, so the handler turns
  // it into a response first.
  const handleGetOrder = (id: string): Promise<string> =>
    runtime.runPromise(
      Orders.use((orders) => orders.status(id)).pipe(
        Effect.map((status) => `200 ${id} ${status}`),
        Effect.catchTag('OrderNotFound', (error) =>
          Effect.succeed(`404 ${error.id}`),
        ),
      ),
    )

  lifecycle.push(await handleGetOrder('o-1'))
  lifecycle.push(await handleGetOrder('o-2'))

  // At shutdown, `dispose` releases the layer and runs its finalizers.
  await runtime.dispose()
  return lifecycle
}

// On this page an Effect calls `main`, so the output can be printed. In a
// real app the framework would drive it.
export const program = Effect.gen(function* () {
  for (const line of yield* Effect.promise(main)) {
    yield* Console.log(line)
  }
})
