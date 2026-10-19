/**
 * @title Calling entities over RPC and HTTP
 * @difficulty intermediate
 * @summary Code outside the cluster, like a browser or another service,
 * cannot use an entity client directly. `EntityProxy` derives an RPC group or
 * an HTTP API from an entity, and `EntityProxyServer` implements it by
 * forwarding each call to the entity with the id in the request.
 */

import { Console, Effect, Layer, Ref, Schema } from 'effect'
import {
  Entity,
  EntityId,
  EntityProxy,
  EntityProxyServer,
  TestRunner,
} from 'effect/cluster'
import { HttpServer } from 'effect/http'
import { HttpApi, HttpApiTest } from 'effect/http-api'
import { Rpc, RpcTest } from 'effect/rpc'

class OutOfStock extends Schema.TaggedError<OutOfStock>()('OutOfStock', {
  sku: Schema.String,
}) {}

const Reserve = Rpc.make('Reserve', {
  payload: { quantity: Schema.Number },
  success: Schema.Number,
  error: OutOfStock,
})
const Stock = Entity.make('Stock', [Reserve])

// Each product's stock is one entity. It starts with five units.
const StockLive = Stock.toLayer(
  Effect.gen(function* () {
    const { entityId } = yield* Entity.CurrentAddress
    const units = yield* Ref.make(5)
    return Stock.of({
      Reserve: ({ payload }) =>
        Effect.gen(function* () {
          const left = (yield* Ref.get(units)) - payload.quantity
          if (left < 0) return yield* new OutOfStock({ sku: entityId })
          yield* Ref.set(units, left)
          return left
        }),
    })
  }),
)

// `toRpcGroup` creates one RPC per entity RPC, named `<Entity>.<Rpc>`, whose
// payload adds the `entityId`. It also adds a `Discard` variant for
// fire-and-forget calls.
class StockRpcs extends EntityProxy.toRpcGroup(Stock) {}

// `toHttpApiGroup` does the same for HTTP: `POST /reserve/:entityId`, plus
// `POST /reserve/:entityId/discard`. Here the group is mounted under
// `/stock`.
class ShopApi extends HttpApi.make('shop').add(
  EntityProxy.toHttpApiGroup('stock', Stock).prefix('/stock'),
) {}

// The proxy handlers need `Sharding` to reach the entity, so they sit on top
// of the cluster. `HttpServer.layerServices` is what an HTTP pipeline needs
// in tests.
const ProxiesLive = Layer.mergeAll(
  EntityProxyServer.layerRpcHandlers(Stock),
  EntityProxyServer.layerHttpApi(ShopApi, 'stock', Stock),
  HttpServer.layerServices,
).pipe(Layer.provideMerge(StockLive), Layer.provideMerge(TestRunner.layer))

export const program = Effect.gen(function* () {
  yield* Console.log(`rpcs: ${[...StockRpcs.requests.keys()].join(', ')}`)

  // Both clients run in memory. `RpcTest.makeClient` connects straight to
  // the RPC handlers, without serializing. `HttpApiTest.groups` runs the
  // whole HTTP pipeline, encoding and routing each request as a server
  // would.
  const rpc = yield* RpcTest.makeClient(StockRpcs)
  const http = yield* HttpApiTest.groups(ShopApi, ['stock'])

  // Both reach the same entity, so they share its stock.
  const afterRpc = yield* rpc['Stock.Reserve']({
    entityId: 'sku-kettle',
    payload: { quantity: 2 },
  })
  yield* Console.log(`over RPC: ${afterRpc} left`)

  // On the HTTP side the id is a path parameter, typed as an `EntityId`.
  const kettle = EntityId.make('sku-kettle')
  const afterHttp = yield* http.stock.Reserve({
    params: { entityId: kettle },
    payload: { quantity: 2 },
  })
  yield* Console.log(`over HTTP: ${afterHttp} left`)

  // The entity's own errors come through as typed errors.
  const error = yield* http.stock
    .Reserve({ params: { entityId: kettle }, payload: { quantity: 2 } })
    .pipe(Effect.flip)
  yield* Console.log(`then: ${error._tag}`)
}).pipe(Effect.scoped, Effect.provide(ProxiesLive))
