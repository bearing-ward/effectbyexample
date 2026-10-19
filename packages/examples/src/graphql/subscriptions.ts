/**
 * @title Subscriptions
 * @difficulty intermediate
 * @summary A subscription is an operation whose client method returns a
 * `Stream` instead of an `Effect`. Each event the server pushes is decoded
 * with the result schema, like a query result.
 */

// Subscriptions use the same client, group, and transport as queries.
import { Console, Effect, Layer, Schema, Stream } from 'effect'
import {
  GraphQL,
  GraphQLClient,
  GraphQLGroup,
  GraphQLProtocol,
} from 'effect/graphql'

// Define it like a query, with `GraphQL.subscription`.
const OrderStatus = GraphQL.subscription('OrderStatus', {
  document:
    'subscription OrderStatus($orderId:ID!){orderStatus(orderId:$orderId){status}}',
  variables: { orderId: Schema.String },
  result: Schema.Struct({
    orderStatus: Schema.Struct({
      status: GraphQL.enumLiterals(['PLACED', 'PACKED', 'SHIPPED']),
    }),
  }),
})

// The transport's `subscribe` returns a stream of raw events. Over HTTP,
// `layerHttp` uses graphql-sse; `layerWebSocket` uses graphql-ws. This
// scripted one pushes three events and completes. `RETURNED` is a status
// the server added after our schema was written.
const ScriptedServer = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
  execute: () => Effect.die('no queries here'),
  subscribe: (request) =>
    Stream.unwrap(
      Console.log('server: subscribed with', request.variables).pipe(
        Effect.as(
          Stream.fromIterable(['PACKED', 'SHIPPED', 'RETURNED']).pipe(
            Stream.map((status) => ({
              body: { data: { orderStatus: { status } } },
            })),
          ),
        ),
      ),
    ),
})

export const program = Effect.gen(function* () {
  const client = yield* GraphQLClient.make(GraphQLGroup.make(OrderStatus))

  // The method returns a `Stream`, so every stream operator applies.
  // `enumLiterals` types the field as the three known values but accepts
  // any string, so a value added later does not fail the subscription.
  yield* client.OrderStatus({ orderId: 'order-7' }).pipe(
    Stream.map((event) => event.orderStatus.status),
    Stream.runForEach((status) => Console.log(`order-7 is ${status}`)),
  )
}).pipe(Effect.provide(ScriptedServer))
