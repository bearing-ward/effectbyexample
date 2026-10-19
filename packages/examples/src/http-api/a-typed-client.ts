/**
 * @title A typed client
 * @difficulty intermediate
 * @summary `HttpApiClient` derives a client from the same API definition the
 * server implements. Each endpoint becomes a method that encodes the request,
 * sends it with any `HttpClient`, and decodes the response with the
 * endpoint's schemas.
 */

import { Console, Context, Effect, Layer, Schema } from 'effect'
import {
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
} from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiClient,
  HttpApiEndpoint,
  HttpApiGroup,
} from 'effect/http-api'

const Order = Schema.Struct({
  id: Schema.String,
  item: Schema.String,
  quantity: Schema.Int,
})

const Api = HttpApi.make('shop').add(
  HttpApiGroup.make('orders')
    .add(
      HttpApiEndpoint.get('get', '/:id', {
        params: { id: Schema.String },
        success: Order,
      }),
      HttpApiEndpoint.post('place', '/', {
        payload: Schema.Struct({ item: Schema.String, quantity: Schema.Int }),
        success: Order,
      }),
    )
    // `prefix` puts every endpoint in the group under `/orders`.
    .prefix('/orders'),
)

const OrdersLive = HttpApiBuilder.group(Api, 'orders', (handlers) =>
  handlers.handleAll({
    get: ({ params }) =>
      Effect.succeed({ id: params.id, item: 'Coffee beans', quantity: 2 }),
    place: ({ payload }) => Effect.succeed({ id: 'order-42', ...payload }),
  }),
)

// The server side: `HttpApiBuilder.layer` turns the API into routes, and
// `HttpRouter.toWebHandler` turns those routes into a function from a Web
// `Request` to a Web `Response`, the shape serverless platforms expect.
const ServerLive = HttpApiBuilder.layer(Api).pipe(
  Layer.provide(OrdersLive),
  Layer.provide(HttpServer.layerServices),
)

// In production the client would use `FetchHttpClient.layer`. To keep this
// page off the network, this `HttpClient` hands each request to the web
// handler in memory. The bytes still go through real Web requests and
// responses.
const InMemoryHttpClient = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const { handler } = yield* Effect.acquireRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(ServerLive, { disableLogger: true }),
      ),
      ({ dispose }) => Effect.promise(dispose),
    )
    return HttpClient.make((request) =>
      HttpServerRequest.toWeb(
        HttpServerRequest.fromClientRequest(request),
      ).pipe(
        Effect.flatMap((web) => Effect.promise(() => handler(web))),
        Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
        Effect.orDie,
      ),
    )
  }),
)

// Wrap the derived client in a service, as you would in an app.
// `transformClient` adapts the underlying `HttpClient`; here it logs each
// request so we can see what the typed calls turn into. The base URL is
// prepended after this step, so the log shows paths.
class ShopClient extends Context.Service<
  ShopClient,
  HttpApiClient.ForApi<typeof Api>
>()('app/ShopClient') {
  static readonly layer = Layer.effect(
    ShopClient,
    HttpApiClient.make(Api, {
      baseUrl: 'http://shop.test',
      transformClient: HttpClient.tapRequest((request) =>
        Console.log(`-> ${request.method} ${request.url}`),
      ),
    }),
  ).pipe(Layer.provide(InMemoryHttpClient))
}

export const program = Effect.gen(function* () {
  const shop = yield* ShopClient

  // Arguments and results are typed from the schemas. A wrong field name or
  // a string quantity is a compile error, not a 400 at runtime.
  const placed = yield* shop.orders.place({
    payload: { item: 'Coffee beans', quantity: 2 },
  })
  yield* Console.log(placed)

  const fetched = yield* shop.orders.get({ params: { id: placed.id } })
  yield* Console.log(fetched)

  // `urlBuilder` uses the same definition to build links without sending
  // anything, handy for redirects and emails.
  const urls = HttpApiClient.urlBuilder(Api, { baseUrl: 'http://shop.test' })
  yield* Console.log(urls.orders.get({ params: { id: 'order-7' } }))
}).pipe(Effect.provide(ShopClient.layer))
