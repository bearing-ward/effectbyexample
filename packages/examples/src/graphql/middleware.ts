/**
 * @title Middleware
 * @difficulty intermediate
 * @summary Middleware wraps every operation it is attached to. Use it to add
 * an auth header to each request, or to read response headers such as rate
 * limits, without touching the code that calls the client.
 */

// Middleware works with any transport. This example uses the HTTP one, to
// show request and response headers.
import { Console, Effect, Layer, Schema } from 'effect'
import {
  GraphQL,
  GraphQLClient,
  GraphQLGroup,
  GraphQLMiddleware,
  GraphQLProtocol,
} from 'effect/graphql'
import { Headers, HttpClient, HttpServerResponse } from 'effect/http'

// A query for the signed-in user, the way GitHub's API has one.
const Viewer = GraphQL.query('Viewer', {
  document: 'query Viewer{viewer{login}}',
  result: Schema.Struct({ viewer: Schema.Struct({ login: Schema.String }) }),
})

// A middleware is declared as a service. Its implementation is provided
// with a layer, like any other service, so it can use config or secrets.
class Auth extends GraphQLMiddleware.Service<Auth>()('app/Auth') {}

// `mapRequest` builds a middleware from a request transform. Request
// headers are immutable `Headers` values, so `Headers.set` returns a copy.
const AuthLive = Layer.succeed(
  Auth,
  GraphQLMiddleware.mapRequest((request) =>
    Effect.succeed({
      ...request,
      headers: Headers.set(
        request.headers,
        'authorization',
        'Bearer dev-token',
      ),
    }),
  ),
)

// The full form gets `next`, which runs the rest of the chain and returns
// the raw result, including the HTTP headers of the response.
class RateLimit extends GraphQLMiddleware.Service<RateLimit>()(
  'app/RateLimit',
) {}

const RateLimitLive = Layer.succeed(RateLimit, {
  execute: ({ next, request }) =>
    next(request).pipe(
      Effect.tap((result) =>
        Console.log(
          `rate limit left: ${result.headers?.['x-ratelimit-remaining']}`,
        ),
      ),
    ),
  subscribe: ({ next, request }) => next(request),
})

// Attaching middleware to the group makes `GraphQLClient.make` require
// both services. Forgetting a layer is a type error, not a runtime surprise.
const GitHubGroup = GraphQLGroup.make(Viewer)
  .middleware(RateLimit)
  .middleware(Auth)

// `layerHttp` is the real HTTP transport. It sends each query as a JSON
// `POST` through whatever `HttpClient` is in context. This stand-in client
// answers like a server would, echoing the auth header back as the login.
const FakeGitHub = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    Effect.gen(function* () {
      yield* Console.log(`${request.method} ${request.url}`)
      const response = HttpServerResponse.jsonUnsafe(
        { data: { viewer: { login: request.headers.authorization } } },
        { headers: { 'x-ratelimit-remaining': '4999' } },
      )
      return HttpServerResponse.toClientResponse(response, { request })
    }),
  ),
)

// The calling code does not mention headers at all. Group middleware run
// in the order attached, so `RateLimit` wraps `Auth`.
export const program = Effect.gen(function* () {
  const client = yield* GraphQLClient.make(GitHubGroup)
  const { viewer } = yield* client.Viewer()
  yield* Console.log(`server saw: ${viewer.login}`)
}).pipe(
  // Compose the layers, then provide them once.
  Effect.provide(
    Layer.mergeAll(
      AuthLive,
      RateLimitLive,
      GraphQLProtocol.layerHttp({ url: 'https://api.github.com/graphql' }),
    ).pipe(Layer.provideMerge(FakeGitHub)),
  ),
)
