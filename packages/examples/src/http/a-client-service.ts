/**
 * @title A client service
 * @difficulty beginner
 * @summary Wrap `HttpClient` in a service of your own. The service sets the
 * base URL once, decodes every response with a schema, and turns HTTP
 * failures into errors your callers understand.
 */

// The `effect/http` modules are marked unstable: their API may change in a
// minor release.
import { Console, Context, Effect, flow, Layer, Schema } from 'effect'
import {
  HttpClient,
  HttpClientError,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/http'

class Todo extends Schema.Class<Todo>('Todo')({
  id: Schema.Int,
  title: Schema.String,
  done: Schema.Boolean,
}) {}

class TodoNotFound extends Schema.TaggedError<TodoNotFound>()('TodoNotFound', {
  id: Schema.Int,
}) {}

// Callers see todos, not responses. A missing todo is a typed
// `TodoNotFound`; any other failure stays an `HttpClientError`, or a
// `SchemaError` when the body has the wrong shape.
class TodoApi extends Context.Service<
  TodoApi,
  {
    getTodo(
      id: number,
    ): Effect.Effect<
      Todo,
      TodoNotFound | HttpClientError.HttpClientError | Schema.SchemaError
    >
  }
>()('app/TodoApi') {
  static readonly layer = Layer.effect(
    TodoApi,
    Effect.gen(function* () {
      // `mapRequest` runs on every request this client sends: prefix the URL
      // and ask for JSON. `filterStatusOk` fails on any non-2xx status.
      const client = (yield* HttpClient.HttpClient).pipe(
        HttpClient.mapRequest(
          flow(
            HttpClientRequest.prependUrl('http://todos.test'),
            HttpClientRequest.acceptJson,
          ),
        ),
        HttpClient.filterStatusOk,
      )

      const getTodo = Effect.fn('TodoApi.getTodo')(function* (id: number) {
        const response = yield* client.get(`/todos/${id}`).pipe(
          // The failure carries a `reason`. A 404 arrives as a
          // `StatusCodeError` with the response attached, so we can turn it
          // into our own error and let every other reason through.
          Effect.catchReason(
            'HttpClientError',
            'StatusCodeError',
            (reason, error) =>
              Effect.fail(
                reason.response.status === 404
                  ? new TodoNotFound({ id })
                  : error,
              ),
          ),
        )
        // Decode the body with the schema. A malformed body fails with a
        // `SchemaError` instead of reaching the caller as a bad `Todo`.
        return yield* HttpClientResponse.schemaBodyJson(Todo)(response)
      })

      return TodoApi.of({ getTodo })
    }),
  )
}

// A tiny in-memory server stands in for the real API, so no network is
// used. `toWebHandler` turns the routes into a function from a Web request
// to a Web response, and `HttpClient.make` sends each request to it.
const FakeServer = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const routes = HttpRouter.add(
      'GET',
      '/todos/:id',
      Effect.gen(function* () {
        const { id } = yield* HttpRouter.params
        return id === '1'
          ? HttpServerResponse.jsonUnsafe({
              id: 1,
              title: 'Buy milk',
              done: false,
            })
          : HttpServerResponse.empty({ status: 404 })
      }),
    ).pipe(Layer.provide(HttpServer.layerServices))
    const { handler } = yield* Effect.acquireRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(routes, { disableLogger: true }),
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
  const api = yield* TodoApi

  // A decoded `Todo` instance, not a plain object.
  const todo = yield* api.getTodo(1)
  yield* Console.log(todo)

  // A missing todo is a typed failure we can match by tag.
  const missing = yield* api
    .getTodo(2)
    .pipe(
      Effect.catchTag('TodoNotFound', (error) =>
        Effect.succeed(`todo ${error.id} not found`),
      ),
    )
  yield* Console.log(missing)
}).pipe(Effect.provide(TodoApi.layer.pipe(Layer.provide(FakeServer))))
