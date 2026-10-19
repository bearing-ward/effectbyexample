/**
 * @title Serving RPCs over HTTP
 * @difficulty intermediate
 * @summary The same group and handlers you test in memory can be served over
 * HTTP. `RpcServer.layerHttp` mounts the group on a route, and
 * `RpcClient.layerProtocolHttp` points a client at it. Both sides must agree
 * on a serialization format.
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
  Rpc,
  RpcClient,
  RpcClientError,
  RpcGroup,
  RpcSerialization,
  RpcServer,
} from 'effect/rpc'

class TodoRpcs extends RpcGroup.make(
  Rpc.make('AddTodo', {
    payload: { title: Schema.String },
    success: Schema.Struct({ id: Schema.Number, title: Schema.String }),
  }),
) {}

const TodoHandlers = TodoRpcs.toLayer(
  Effect.gen(function* () {
    let nextId = 1
    return TodoRpcs.of({
      AddTodo: ({ title }) => Effect.sync(() => ({ id: nextId++, title })),
    })
  }),
)

// Server side: mount the group at `POST /rpc` on an `HttpRouter`. Requests
// and responses are newline-delimited JSON, which lets one HTTP response carry
// a stream of results.
const RpcRoutes = RpcServer.layerHttp({
  group: TodoRpcs,
  path: '/rpc',
  protocol: 'http',
}).pipe(
  Layer.provide(TodoHandlers),
  Layer.provide(RpcSerialization.layerNdjson),
)

// The router becomes a Web handler, as on a serverless platform. In place of
// the network, this `HttpClient` hands each request straight to the handler.
// `filterStatusOk` makes it treat any non-2xx response as an error.
const { handler, dispose } = HttpRouter.toWebHandler(
  RpcRoutes.pipe(Layer.provide(HttpServer.layerServices)),
  { disableLogger: true },
)
const InMemoryHttp = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request) =>
    HttpServerRequest.toWeb(HttpServerRequest.fromClientRequest(request)).pipe(
      Effect.flatMap((web) => Effect.promise(() => handler(web))),
      Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
      Effect.orDie,
    ),
  ).pipe(HttpClient.filterStatusOk),
)

// Client side: a service holding the generated client. The protocol layer
// sends each call as an HTTP request to `url`, using the same serialization.
class TodoClient extends Context.Service<
  TodoClient,
  RpcClient.RpcClient<
    RpcGroup.Rpcs<typeof TodoRpcs>,
    RpcClientError.RpcClientError
  >
>()('app/TodoClient') {
  static readonly layer = (url: string) =>
    Layer.effect(TodoClient, RpcClient.make(TodoRpcs)).pipe(
      Layer.provide(RpcClient.layerProtocolHttp({ url })),
      Layer.provide(RpcSerialization.layerNdjson),
      Layer.provide(InMemoryHttp),
    )
}

export const program = Effect.gen(function* () {
  const todo = yield* TodoClient.use((client) =>
    client.AddTodo({ title: 'Buy milk' }),
  ).pipe(Effect.provide(TodoClient.layer('http://api.test/rpc')))
  yield* Console.log(todo)

  // A real client can also fail for reasons the handlers never see: the
  // network, a wrong URL, a server that is down. Those arrive as an
  // `RpcClientError`, whose `reason` says what went wrong. Here the router
  // answers 404, and `filterStatusOk` turns that into a status code error.
  const failure = yield* TodoClient.use((client) =>
    client.AddTodo({ title: 'Lost' }),
  ).pipe(
    Effect.provide(TodoClient.layer('http://api.test/wrong-path')),
    Effect.flip,
  )
  const { reason } = failure
  yield* Console.log(
    reason._tag === 'HttpError'
      ? `${reason._tag}: ${reason.kind}`
      : reason._tag,
  )
}).pipe(Effect.ensuring(Effect.promise(dispose)))
