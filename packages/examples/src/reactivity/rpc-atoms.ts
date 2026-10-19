/**
 * @title Atoms from RPC
 * @difficulty advanced
 * @summary `AtomRpc.Service` does for an `RpcGroup` what `AtomHttpApi` does
 * for an HTTP API: each procedure becomes a query atom or a mutation atom.
 * Here the client talks to the handlers in memory, through `RpcTest`.
 */

import { Console, Effect, Ref, Schema } from 'effect'
import { AsyncResult, AtomRegistry, AtomRpc } from 'effect/reactivity'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'

class Order extends Schema.Class<Order>('Order')({
  id: Schema.String,
  item: Schema.String,
}) {}

class SoldOut extends Schema.TaggedError<SoldOut>()('SoldOut', {
  item: Schema.String,
}) {}

class OrderRpcs extends RpcGroup.make(
  Rpc.make('ListOrders', { success: Schema.Array(Order) }),
  Rpc.make('PlaceOrder', {
    payload: { item: Schema.String },
    success: Order,
    error: SoldOut,
  }),
) {}

// The server side: handlers that keep orders in a `Ref`.
const OrderHandlers = OrderRpcs.toLayer(
  Effect.gen(function* () {
    const orders = yield* Ref.make<Array<Order>>([])
    return OrderRpcs.of({
      ListOrders: () => Ref.get(orders),
      PlaceOrder: Effect.fn(function* ({ item }) {
        if (item === 'Gold kettle') {
          return yield* new SoldOut({ item })
        }
        const all = yield* Ref.get(orders)
        const order = new Order({ id: `order-${all.length + 1}`, item })
        yield* Ref.set(orders, [...all, order])
        return order
      }),
    })
  }),
)

// Normally `protocol` is a transport layer, such as HTTP or WebSocket.
// `makeEffect` swaps the client for `RpcTest.makeClient`, which calls the
// handlers directly, and `protocol` then only has to supply the handlers.
// `AtomRpc` is marked `@stability unstable`.
class OrderClient extends AtomRpc.Service<OrderClient>()('OrderClient', {
  group: OrderRpcs,
  makeEffect: RpcTest.makeClient(OrderRpcs, { flatten: true }),
  protocol: OrderHandlers,
}) {}

export const program = Effect.gen(function* () {
  // `query` takes the procedure tag and its payload. Equal arguments give
  // back the same atom, so every component shares one request.
  const orders = OrderClient.query('ListOrders', undefined, {
    reactivityKeys: ['orders'],
  })
  const placeOrder = OrderClient.mutation('PlaceOrder')
  const sameQuery = OrderClient.query('ListOrders', undefined, {
    reactivityKeys: ['orders'],
  })
  yield* Console.log(`same atom: ${sameQuery === orders}`)

  const registry = AtomRegistry.make()
  const unmount = registry.mount(orders)
  const items = Effect.map(
    AtomRegistry.getResult(registry, orders, { suspendOnWaiting: true }),
    (list) => list.map((order) => order.item),
  )
  yield* Console.log('orders:', yield* items)

  // Each mutation passes the keys to invalidate. The list reloads.
  registry.set(placeOrder, {
    payload: { item: 'Teapot' },
    reactivityKeys: ['orders'],
  })
  const placed = yield* AtomRegistry.getResult(registry, placeOrder)
  yield* Console.log(`placed ${placed.id}`)
  yield* Console.log('orders:', yield* items)

  // A typed error from the handler ends up in the mutation's `AsyncResult`.
  // The mutation failed, so the list is not invalidated: its subscriber
  // hears nothing.
  let listUpdates = 0
  const stop = registry.subscribe(orders, () => listUpdates++)
  registry.set(placeOrder, {
    payload: { item: 'Gold kettle' },
    reactivityKeys: ['orders'],
  })
  yield* Effect.exit(AtomRegistry.getResult(registry, placeOrder))
  const failed = registry.get(placeOrder)
  yield* Console.log(
    AsyncResult.builder(failed)
      .onErrorTag('SoldOut', (error) => `sold out: ${error.item}`)
      .orElse(() => `unexpected state: ${failed._tag}`),
  )
  yield* Console.log(`list updates: ${listUpdates}`)

  stop()
  unmount()
  registry.dispose()
})
