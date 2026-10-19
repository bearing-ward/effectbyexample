/**
 * @title Routes, params, and error responses
 * @difficulty intermediate
 * @summary `HttpRouter` matches a method and path to a handler. Handlers read
 * typed path parameters, and their failures become HTTP status codes: an
 * error can describe its own response, and the router has sensible defaults
 * for the rest.
 */

import { Console, Effect, Layer, Schema } from 'effect'
import {
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerError,
  HttpServerRequest,
  HttpServerRespondable,
  HttpServerResponse,
} from 'effect/http'

const orders = new Map([[7, { id: 7, item: 'Coffee beans' }]])

// An error that knows its own response. The router looks for the
// `HttpServerRespondable.symbol` method on any failure and sends what it
// returns, here a 404 with a JSON body.
class OrderNotFound extends Schema.TaggedError<OrderNotFound>()(
  'OrderNotFound',
  { id: Schema.Number },
) {
  [HttpServerRespondable.symbol]() {
    return HttpServerResponse.json(
      { error: `order ${this.id} does not exist` },
      { status: 404 },
    )
  }
}

// `schemaPathParams` decodes the `:id` segment. It arrives as a string, and
// `FiniteFromString` turns it into a number or fails with a `SchemaError`.
const getOrder = Effect.gen(function* () {
  const { id } = yield* HttpRouter.schemaPathParams(
    Schema.Struct({ id: Schema.FiniteFromString }),
  )
  const order = orders.get(id)
  if (order === undefined) {
    return yield* new OrderNotFound({ id })
  }
  return HttpServerResponse.jsonUnsafe(order)
})

// Reading the body can fail too. A body that is not JSON fails with an
// `HttpServerError` whose `reason` is a `RequestParseError`. Left alone it
// becomes a 400; here we catch it to explain the problem to the caller.
// `isHttpServerError` picks it out from the schema's own `SchemaError`.
const placeOrder = Effect.gen(function* () {
  const order = yield* HttpServerRequest.schemaBodyJson(
    Schema.Struct({ item: Schema.String }),
  )
  return HttpServerResponse.jsonUnsafe({ id: 8, ...order }, { status: 201 })
}).pipe(
  Effect.catchIf(HttpServerError.isHttpServerError, (error) =>
    HttpServerResponse.json({ error: error.reason._tag }, { status: 400 }),
  ),
)

// `addAll` registers several routes at once, all under the `/orders` prefix.
const Routes = HttpRouter.addAll(
  [
    HttpRouter.route('GET', '/:id', getOrder),
    HttpRouter.route('POST', '/', placeOrder),
    // A defect is a bug, not an expected failure. It becomes a bare 500 and
    // the details stay on the server.
    HttpRouter.route('POST', '/:id/refund', Effect.die('refunds are broken')),
  ],
  { prefix: '/orders' },
).pipe(Layer.provide(HttpServer.layerServices))

const InMemoryClient = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const { handler } = yield* Effect.acquireRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(Routes, { disableLogger: true }),
      ),
      ({ dispose }) => Effect.promise(dispose),
    )
    return HttpClient.make((request) =>
      HttpServerRequest.toWeb(
        HttpServerRequest.fromClientRequest(request),
      ).pipe(
        Effect.flatMap((web) => Effect.promise(() => handler(web))),
        Effect.map((web) => HttpClientResponse.fromWeb(request, web)),
        Effect.orDie,
      ),
    )
  }),
)

export const program = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const send = Effect.fnUntraced(function* (
    request: HttpClientRequest.HttpClientRequest,
  ) {
    const response = yield* client.execute(
      HttpClientRequest.prependUrl(request, 'http://shop.test'),
    )
    const body = yield* response.text
    yield* Console.log(
      `${request.method} ${request.url} -> ${response.status} ${body}`,
    )
  })

  // A match: the decoded id finds the order.
  yield* send(HttpClientRequest.get('/orders/7'))
  // Our own error, answered by its `Respondable` method.
  yield* send(HttpClientRequest.get('/orders/8'))
  // A `SchemaError` from a bad parameter becomes a 400 by default.
  yield* send(HttpClientRequest.get('/orders/seven'))
  // No route matches. The router fails with an `HttpServerError` whose
  // reason is `RouteNotFound`, and that becomes a 404.
  yield* send(HttpClientRequest.get('/customers/1'))
  // A body that is not JSON, caught by the handler.
  yield* send(
    HttpClientRequest.post('/orders').pipe(
      HttpClientRequest.bodyText('{ oops', 'application/json'),
    ),
  )
  yield* send(
    HttpClientRequest.post('/orders').pipe(
      HttpClientRequest.bodyJsonUnsafe({ item: 'Tea' }),
    ),
  )
  yield* send(HttpClientRequest.post('/orders/7/refund'))
}).pipe(Effect.provide(InMemoryClient))
