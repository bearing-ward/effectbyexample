/**
 * @title Middleware
 * @difficulty intermediate
 * @summary Middleware wraps every RPC in a group. A typical one checks a
 * token, rejects the call or provides the current user to the handler. A
 * matching client middleware attaches the token on the way out.
 */

import { Console, Context, Effect, Layer, Schema } from 'effect'
import { Headers } from 'effect/http'
import { Rpc, RpcGroup, RpcMiddleware, RpcTest } from 'effect/rpc'

class CurrentUser extends Context.Service<CurrentUser, { name: string }>()(
  'app/CurrentUser',
) {}

class Unauthorized extends Schema.TaggedError<Unauthorized>()('Unauthorized', {
  reason: Schema.String,
}) {}

// The class declares what the middleware does. It `provides` `CurrentUser`
// to handlers, may fail with `Unauthorized`, and `requiredForClient` makes
// every client supply a client-side half.
class Auth extends RpcMiddleware.Service<Auth, { provides: CurrentUser }>()(
  'app/Auth',
  { error: Unauthorized, requiredForClient: true },
) {}

// `.middleware` applies it to every RPC added before it. The handler now
// requires `CurrentUser` and gets it from the middleware.
class AccountRpcs extends RpcGroup.make(
  Rpc.make('WhoAmI', { success: Schema.String }),
).middleware(Auth) {}

const AccountHandlers = AccountRpcs.toLayer({
  WhoAmI: () =>
    Effect.gen(function* () {
      const user = yield* CurrentUser
      return `you are ${user.name}`
    }),
})

// The server half receives the handler as an effect, plus request details
// such as the headers. It can fail, or run the handler with extra services.
const AuthServer = Layer.succeed(Auth, (handler, { headers }) =>
  headers.authorization === 'Bearer ada-token'
    ? Effect.provideService(handler, CurrentUser, { name: 'Ada' })
    : Effect.fail(new Unauthorized({ reason: 'missing or wrong token' })),
)

// The client half sees each outgoing request and passes it on with `next`.
const withToken = (token: string) =>
  RpcMiddleware.layerClient(Auth, ({ request, next }) =>
    next({
      ...request,
      headers: Headers.set(request.headers, 'authorization', `Bearer ${token}`),
    }),
  )

const whoAmI = Effect.gen(function* () {
  const client = yield* RpcTest.makeClient(AccountRpcs)
  return yield* client.WhoAmI()
}).pipe(
  Effect.catchTag('Unauthorized', (error) =>
    Effect.succeed(`rejected: ${error.reason}`),
  ),
  Effect.scoped,
)

export const program = Effect.gen(function* () {
  // Same server, two clients with different tokens.
  yield* Console.log(yield* whoAmI.pipe(Effect.provide(withToken('ada-token'))))
  yield* Console.log(yield* whoAmI.pipe(Effect.provide(withToken('guess'))))
}).pipe(Effect.provide([AccountHandlers, AuthServer]))
