/**
 * @title Building requests
 * @difficulty beginner
 * @summary An `HttpClientRequest` is an immutable value. You build it step by
 * step with `HttpClientRequest` functions, inspect it, and only then hand it
 * to a client. Nothing is sent until you execute it.
 */

import { Console, Effect, Layer, Schema } from 'effect'
import {
  Headers,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpMethod,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  UrlParams,
} from 'effect/http'

const NewOrder = Schema.Struct({ item: Schema.String, quantity: Schema.Int })

// The server echoes back what it received. `HttpMethod.hasBody` tells it
// whether the method can carry a body, so a `GET` is not read for one.
const EchoRoute = HttpRouter.add('*', '/orders', (request) =>
  Effect.gen(function* () {
    const body = HttpMethod.hasBody(request.method) ? yield* request.json : null
    return HttpServerResponse.jsonUnsafe({
      method: request.method,
      url: request.url,
      authorization: request.headers['authorization'],
      body,
    })
  }),
).pipe(Layer.provide(HttpServer.layerServices))

// An `HttpClient` that sends every request to the routes above, in memory.
const EchoClient = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const { handler } = yield* Effect.acquireRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(EchoRoute, { disableLogger: true }),
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
  // Each step returns a new request. `schemaBodyJson` encodes the body with
  // the schema and sets `content-type`, so it can fail and is an Effect.
  const request = yield* HttpClientRequest.post('http://shop.test/orders').pipe(
    HttpClientRequest.setUrlParams({ dryRun: 'true', tag: ['gift', 'rush'] }),
    HttpClientRequest.bearerToken('secret-token'),
    HttpClientRequest.setHeader('x-client', 'checkout'),
    HttpClientRequest.schemaBodyJson(NewOrder)({ item: 'Coffee', quantity: 2 }),
  )

  // The request is plain data you can look at before sending it.
  // `UrlParams` keeps repeated keys. `Headers.redact` wraps the named
  // headers in `Redacted`, so a log line never shows the token.
  yield* Console.log(request.method, request.url)
  yield* Console.log(UrlParams.toString(request.urlParams))
  yield* Console.log(Headers.redact(request.headers, 'authorization'))

  // Execute it. The server sees the real token and the encoded body.
  const client = yield* HttpClient.HttpClient
  const echoed = yield* client
    .execute(request)
    .pipe(Effect.flatMap((response) => response.json))
  yield* Console.log(echoed)

  // The shortcut methods take the same pieces as options.
  const fetched = yield* client
    .get('http://shop.test/orders', { urlParams: { status: 'open' } })
    .pipe(Effect.flatMap((response) => response.json))
  yield* Console.log(fetched)
}).pipe(Effect.provide(EchoClient))
