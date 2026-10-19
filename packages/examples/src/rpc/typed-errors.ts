/**
 * @title Typed errors
 * @difficulty beginner
 * @summary Give an RPC an `error` schema and its failures travel to the
 * client as typed values. The client handles them with `catchTag`, exactly as
 * if the handler had run locally.
 */

import { Console, Effect, Schema } from 'effect'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'

// Errors are schemas too, so they can be encoded and sent over the wire.
// `Schema.TaggedError` gives each one a `_tag` to match on.
class OrderNotFound extends Schema.TaggedError<OrderNotFound>()(
  'OrderNotFound',
  { orderId: Schema.String },
) {}

class OrderAlreadyShipped extends Schema.TaggedError<OrderAlreadyShipped>()(
  'OrderAlreadyShipped',
  { orderId: Schema.String },
) {}

// `error` takes one schema. Use a union when an RPC can fail in more than one
// way.
const CancelOrder = Rpc.make('CancelOrder', {
  payload: { orderId: Schema.String },
  success: Schema.String,
  error: Schema.Union([OrderNotFound, OrderAlreadyShipped]),
})

class OrderRpcs extends RpcGroup.make(CancelOrder) {}

const shipped = new Set(['order-2'])

// The handler's error type must match the schema. Failing with an error the
// RPC does not declare is a type error.
const OrderHandlers = OrderRpcs.toLayer({
  CancelOrder: ({ orderId }) =>
    Effect.gen(function* () {
      if (orderId === 'order-404') {
        return yield* new OrderNotFound({ orderId })
      }
      if (shipped.has(orderId)) {
        return yield* new OrderAlreadyShipped({ orderId })
      }
      return `cancelled ${orderId}`
    }),
})

export const program = Effect.gen(function* () {
  const client = yield* RpcTest.makeClient(OrderRpcs)

  // On the client, the call's type is
  // `Effect<string, OrderNotFound | OrderAlreadyShipped>`.
  const cancel = (orderId: string) =>
    client.CancelOrder({ orderId }).pipe(
      Effect.catchTags({
        OrderNotFound: (error) =>
          Effect.succeed(`no such order: ${error.orderId}`),
        OrderAlreadyShipped: (error) =>
          Effect.succeed(`too late, ${error.orderId} has shipped`),
      }),
    )

  yield* Console.log(yield* cancel('order-1'))
  yield* Console.log(yield* cancel('order-2'))
  yield* Console.log(yield* cancel('order-404'))
}).pipe(Effect.provide(OrderHandlers), Effect.scoped)
