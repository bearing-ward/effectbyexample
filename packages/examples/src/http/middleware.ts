/**
 * @title Middleware
 * @difficulty intermediate
 * @summary Middleware wraps handlers. Route middleware can reject a request
 * or provide a service to the handlers behind it, such as the signed-in user.
 * Global middleware runs for every request, matched or not.
 */

import { Console, Context, Effect, Layer } from 'effect'
import {
  HttpClient,
  HttpClientResponse,
  HttpEffect,
  HttpMiddleware,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/http'

class CurrentUser extends Context.Service<CurrentUser, { name: string }>()(
  'app/CurrentUser',
) {}

const apiKeys = new Map([['key-ada', { name: 'Ada' }]])

// Route middleware. The type parameter says it `provides` `CurrentUser`, so
// routes behind it may use the service. It either answers 401 itself or
// runs the handler with the user provided.
const Authenticate = HttpRouter.middleware<{ provides: CurrentUser }>()(
  (handler) =>
    Effect.gen(function* () {
      const request = yield* HttpServerRequest.HttpServerRequest
      const user = apiKeys.get(request.headers['x-api-key'] ?? '')
      if (user === undefined) {
        return HttpServerResponse.text('unknown api key', { status: 401 })
      }
      return yield* Effect.provideService(handler, CurrentUser, user)
    }),
)

// The handler reads the user like any other service. Without the middleware
// layer, `CurrentUser` would remain an unmet requirement in the route's type.
const MeRoute = HttpRouter.add(
  'GET',
  '/me',
  Effect.gen(function* () {
    const user = yield* CurrentUser
    return HttpServerResponse.text(`hello ${user.name}`)
  }),
).pipe(Layer.provide(Authenticate.layer))

// Global middleware. `HttpEffect.appendPreResponseHandler` edits the
// response just before it is sent, so the header also lands on the 401 from
// `Authenticate` and on the 404 for an unknown path.
const ApiVersion = HttpRouter.middleware(
  (handler) =>
    Effect.andThen(
      HttpEffect.appendPreResponseHandler((_request, response) =>
        Effect.succeed(HttpServerResponse.setHeader(response, 'x-api', 'v2')),
      ),
      handler,
    ),
  { global: true },
)

// `HttpMiddleware` has ready-made middleware. `cors` answers browser
// preflight requests and adds CORS headers for the origins you allow, here
// any subdomain of `shop.test`. The predicate also runs for requests that
// send no `Origin` header, so it must accept `undefined`.
const Cors = HttpRouter.middleware(
  HttpMiddleware.cors({
    allowedOrigins: (origin: string | undefined) =>
      origin?.endsWith('.shop.test') === true,
  }),
  { global: true },
)

const App = Layer.mergeAll(MeRoute, ApiVersion, Cors).pipe(
  Layer.provide(HttpServer.layerServices),
)

const InMemoryClient = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const { handler } = yield* Effect.acquireRelease(
      Effect.sync(() => HttpRouter.toWebHandler(App, { disableLogger: true })),
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
  const show = Effect.fnUntraced(function* (
    path: string,
    headers: Record<string, string> = {},
  ) {
    const response = yield* client.get(`http://shop.test${path}`, { headers })
    const body = yield* response.text
    yield* Console.log(
      `${path} ${response.status} "${body}" x-api=${response.headers['x-api']}`,
    )
  })

  // A known key reaches the handler, a missing key is stopped by
  // `Authenticate`, and an unknown path never matches a route. All three get
  // the global header.
  yield* show('/me', { 'x-api-key': 'key-ada' })
  yield* show('/me')
  yield* show('/missing')

  // A browser sends an `OPTIONS` preflight before a cross-origin request.
  // The allowed origin is echoed back; the other gets no allow header.
  for (const origin of ['https://app.shop.test', 'https://evil.test']) {
    const preflight = yield* client.options('http://shop.test/me', {
      headers: { origin },
    })
    yield* Console.log(origin, preflight.status, {
      allowOrigin: preflight.headers['access-control-allow-origin'],
      allowMethods: preflight.headers['access-control-allow-methods'],
    })
  }
}).pipe(Effect.provide(InMemoryClient))
