/**
 * @title Cookies and sessions
 * @difficulty intermediate
 * @summary The server sets and expires cookies on its responses and decodes
 * them from requests with a schema. On the client, `withCookiesRef` keeps a
 * cookie jar so later requests send the session back, like a browser does.
 */

import { Console, Effect, Layer, Ref, Schema } from 'effect'
import {
  Cookies,
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/http'

const Routes = HttpRouter.addAll([
  // `setCookie` validates the name, value, and options, so it returns an
  // Effect that can fail with a `CookiesError`.
  HttpRouter.route(
    'POST',
    '/login',
    HttpServerResponse.text('welcome').pipe(
      HttpServerResponse.setCookie('session', 'sess-ada', {
        httpOnly: true,
        sameSite: 'lax',
        path: '/',
        maxAge: '1 hour',
      }),
    ),
  ),
  // `schemaCookies` decodes the request's cookies. Without a non-empty
  // session the decode fails, and a `SchemaError` becomes a 400.
  HttpRouter.route(
    'GET',
    '/cart',
    Effect.gen(function* () {
      const { session } = yield* HttpServerRequest.schemaCookies(
        Schema.Struct({ session: Schema.NonEmptyString }),
      )
      return HttpServerResponse.text(`cart for ${session}`)
    }),
  ),
  // Expiring a cookie sends it back with a date in the past.
  HttpRouter.route(
    'POST',
    '/logout',
    HttpServerResponse.empty().pipe(
      HttpServerResponse.expireCookie('session', { path: '/' }),
    ),
  ),
]).pipe(Layer.provide(HttpServer.layerServices))

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
  // The jar is a `Ref` of `Cookies`. The client stores every `Set-Cookie`
  // it receives there and sends the stored cookies on each request.
  const jar = yield* Ref.make(Cookies.empty)
  const client = (yield* HttpClient.HttpClient).pipe(
    HttpClient.withCookiesRef(jar),
  )
  const url = (path: string) => `http://shop.test${path}`
  const status = (path: string) =>
    client
      .get(url(path))
      .pipe(
        Effect.flatMap((response) =>
          Effect.map(response.text, (text) => `${response.status} ${text}`),
        ),
      )

  yield* Console.log('before login:', yield* status('/cart'))

  // The response's `cookies` are parsed from its `Set-Cookie` headers.
  const login = yield* client.post(url('/login'))
  yield* Console.log(Cookies.toSetCookieHeaders(login.cookies))
  yield* Console.log('jar:', Cookies.toRecord(yield* Ref.get(jar)))
  yield* Console.log('after login:', yield* status('/cart'))

  // Logging out expires the cookie. Unlike a browser, the jar does not
  // delete it: it stores the empty value and keeps sending `session=`. That
  // is why the server insists on a non-empty session.
  const logout = yield* client.post(url('/logout'))
  yield* Console.log(Cookies.toSetCookieHeaders(logout.cookies))
  yield* Console.log('jar:', Cookies.toRecord(yield* Ref.get(jar)))
  yield* Console.log('after logout:', yield* status('/cart'))
}).pipe(Effect.provide(InMemoryClient))
