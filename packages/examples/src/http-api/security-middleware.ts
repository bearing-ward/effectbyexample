/**
 * @title Authentication with middleware
 * @difficulty advanced
 * @summary Security middleware reads credentials from each request, rejects
 * the ones it does not trust, and hands the signed-in user to the handlers as
 * a service. `HttpApiSecurity` describes where the credential lives: a bearer
 * token, an API key, or basic auth.
 */

import { Console, Context, Effect, Layer, Redacted, Schema } from 'effect'
import { HttpClientRequest, HttpServer } from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSecurity,
  HttpApiTest,
} from 'effect/http-api'

// The service the middleware provides. Handlers ask for it like any other.
class CurrentUser extends Context.Service<
  CurrentUser,
  { readonly name: string }
>()('app/CurrentUser') {}

class Unauthorized extends Schema.TaggedError<Unauthorized>()(
  'Unauthorized',
  { message: Schema.String },
  { httpApiStatus: 401 },
) {}

// The middleware declares what it provides, which error it can fail with,
// and its security schemes. Each scheme is tried in order until one
// succeeds: an `Authorization: Bearer ...` header, then an `x-api-key`
// header. `requiredForClient` makes clients supply a matching middleware
// that attaches the credential.
class Authorization extends HttpApiMiddleware.Service<
  Authorization,
  { provides: CurrentUser }
>()('app/Authorization', {
  error: Unauthorized,
  security: {
    bearer: HttpApiSecurity.bearer,
    apiKey: HttpApiSecurity.apiKey({ key: 'x-api-key' }),
  },
  requiredForClient: true,
}) {}

// `.middleware` protects every endpoint in the group.
const Api = HttpApi.make('accounts').add(
  HttpApiGroup.make('account')
    .add(HttpApiEndpoint.get('me', '/me', { success: Schema.String }))
    .middleware(Authorization),
)

// The server side implements one function per scheme. Each receives the
// decoded credential, wrapped in `Redacted` so it never shows up in logs.
// A missing credential arrives as an empty string.
const AuthorizationLive = Layer.succeed(Authorization, {
  bearer: (httpEffect, { credential }) =>
    Redacted.value(credential) === 'token-ada'
      ? Effect.provideService(httpEffect, CurrentUser, { name: 'Ada' })
      : Effect.fail(new Unauthorized({ message: 'bad bearer token' })),
  apiKey: (httpEffect, { credential }) =>
    Redacted.value(credential) === 'key-grace'
      ? Effect.provideService(httpEffect, CurrentUser, { name: 'Grace' })
      : Effect.fail(new Unauthorized({ message: 'bad API key' })),
})

// The handler never sees a credential, only the user the middleware found.
const AccountLive = HttpApiBuilder.group(Api, 'account', (handlers) =>
  handlers.handle('me', () =>
    CurrentUser.useSync((user) => `signed in as ${user.name}`),
  ),
)

// Client middleware runs before each request leaves. These three attach a
// bearer token, an API key, or nothing.
const withRequest = (
  f: (
    request: HttpClientRequest.HttpClientRequest,
  ) => HttpClientRequest.HttpClientRequest,
) =>
  HttpApiMiddleware.layerClient(Authorization, ({ next, request }) =>
    next(f(request)),
  )
const asAda = withRequest(HttpClientRequest.bearerToken('token-ada'))
const asGrace = withRequest(
  HttpClientRequest.setHeader('x-api-key', 'key-grace'),
)
const anonymous = withRequest((request) => request)

const callMe = HttpApiTest.groups(Api, ['account']).pipe(
  Effect.flatMap((client) => client.account.me()),
  Effect.catchTag('Unauthorized', (error) =>
    Effect.succeed(`401: ${error.message}`),
  ),
)

export const program = Effect.gen(function* () {
  yield* Console.log(yield* Effect.provide(callMe, asAda))
  yield* Console.log(yield* Effect.provide(callMe, asGrace))
  // With no credential every scheme fails, and the last failure is the one
  // returned to the client.
  yield* Console.log(yield* Effect.provide(callMe, anonymous))
}).pipe(
  Effect.provide(
    Layer.mergeAll(
      AccountLive.pipe(Layer.provideMerge(AuthorizationLive)),
      HttpServer.layerServices,
    ),
  ),
  Effect.scoped,
)
