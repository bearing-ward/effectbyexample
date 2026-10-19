/**
 * @title Errors and status codes
 * @difficulty intermediate
 * @summary Endpoints declare their errors as schemas, each tied to an HTTP
 * status. The server encodes a failure into that status and body, and the
 * derived client decodes it back into the same typed error.
 */

import { Console, Effect, Layer, Ref, Schema } from 'effect'
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
  HttpApiError,
  HttpApiGroup,
  HttpApiSchema,
} from 'effect/http-api'

// A domain error is a `Schema.TaggedError`. `httpApiStatus` says which status
// it travels with. Its fields become the JSON body.
class TodoNotFound extends Schema.TaggedError<TodoNotFound>()(
  'TodoNotFound',
  { id: Schema.Int },
  { httpApiStatus: 404 },
) {}

const Todo = Schema.Struct({ id: Schema.Int, title: Schema.String })

const Api = HttpApi.make('todos').add(
  HttpApiGroup.make('todos').add(
    HttpApiEndpoint.get('get', '/todos/:id', {
      params: { id: Schema.Int },
      success: Todo,
      error: TodoNotFound,
    }),
    // `HttpApiSchema.status` changes the success status. `HttpApiError` has
    // ready-made errors for common cases, such as `Conflict` (409).
    HttpApiEndpoint.post('create', '/todos', {
      payload: Schema.Struct({ title: Schema.String }),
      success: Todo.pipe(HttpApiSchema.status(201)),
      error: HttpApiError.Conflict,
    }),
    // `HttpApiSchema.NoContent` is an empty 204 response.
    HttpApiEndpoint.delete('remove', '/todos/:id', {
      params: { id: Schema.Int },
      success: HttpApiSchema.NoContent,
    }),
  ),
)

const TodosLive = HttpApiBuilder.group(
  Api,
  'todos',
  Effect.fn(function* (handlers) {
    const todos = yield* Ref.make([{ id: 1, title: 'Buy milk' }])
    return handlers.handleAll({
      // Failing with the declared error is enough. No status code in sight.
      get: ({ params }) =>
        Ref.get(todos).pipe(
          Effect.map((all) => all.find((todo) => todo.id === params.id)),
          Effect.flatMap((todo) =>
            todo ? Effect.succeed(todo) : new TodoNotFound({ id: params.id }),
          ),
        ),
      create: Effect.fn(function* ({ payload }) {
        const all = yield* Ref.get(todos)
        if (all.some((todo) => todo.title === payload.title)) {
          return yield* new HttpApiError.Conflict()
        }
        const todo = { id: all.length + 1, title: payload.title }
        yield* Ref.set(todos, [...all, todo])
        return todo
      }),
      remove: ({ params }) =>
        Ref.update(todos, (all) => all.filter((todo) => todo.id !== params.id)),
    })
  }),
)

export const program = Effect.gen(function* () {
  const { handler } = yield* Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(
        HttpApiBuilder.layer(Api).pipe(
          Layer.provide(TodosLive),
          Layer.provide(HttpServer.layerServices),
        ),
        { disableLogger: true },
      ),
    ),
    ({ dispose }) => Effect.promise(dispose),
  )

  // An in-memory `HttpClient` that calls the web handler and prints each
  // response status, so we can see what crosses the wire.
  const httpClient = HttpClient.make((request) =>
    HttpServerRequest.toWeb(HttpServerRequest.fromClientRequest(request)).pipe(
      Effect.flatMap((web) => Effect.promise(() => handler(web))),
      Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
      Effect.orDie,
    ),
  ).pipe(
    HttpClient.tap((response) =>
      Console.log(`<- ${response.request.method} ${response.status}`),
    ),
  )
  const client = yield* HttpApiClient.makeWith(Api, {
    httpClient,
    baseUrl: 'http://todos.test',
  })

  yield* Console.log(yield* client.todos.create({ payload: { title: 'Read' } }))

  // On the client the 404 is a `TodoNotFound` again, with its `id` field.
  // The failure is in the type, so `catchTag` can handle it by name.
  yield* client.todos
    .get({ params: { id: 99 } })
    .pipe(
      Effect.catchTag('TodoNotFound', (error) =>
        Console.log(`no todo with id ${error.id}`),
      ),
    )

  yield* client.todos
    .create({ payload: { title: 'Read' } })
    .pipe(
      Effect.catchTag('Conflict', () =>
        Console.log('that todo already exists'),
      ),
    )

  yield* client.todos.remove({ params: { id: 1 } })

  // Input that does not match the schemas never reaches a handler. A raw
  // request with a non-numeric id gets an empty 400: the server does not
  // echo decoding details back to callers.
  const response = yield* httpClient.get('http://todos.test/todos/first')
  yield* Console.log(`body: ${JSON.stringify(yield* response.text)}`)
}).pipe(Effect.scoped)
