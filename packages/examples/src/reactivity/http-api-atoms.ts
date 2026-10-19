/**
 * @title Atoms from an HttpApi
 * @difficulty advanced
 * @summary `AtomHttpApi.Service` turns an `HttpApi` definition into atoms.
 * `query` gives an atom per request, holding an `AsyncResult`. `mutation`
 * gives a writable atom that sends a request, and its reactivity keys
 * refresh the queries that read the same data.
 */

import { Console, Effect, Layer, Schema } from 'effect'
import {
  HttpClient,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
} from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
} from 'effect/http-api'
import { AsyncResult, AtomHttpApi, AtomRegistry } from 'effect/reactivity'

class Todo extends Schema.Class<Todo>('Todo')({
  id: Schema.Number,
  title: Schema.String,
}) {}

// The API definition is shared by the server and the client.
class TodoApi extends HttpApi.make('todo-api').add(
  HttpApiGroup.make('todos').add(
    HttpApiEndpoint.get('list', '/todos', { success: Schema.Array(Todo) }),
    HttpApiEndpoint.post('create', '/todos', {
      payload: Schema.Struct({ title: Schema.String }),
      success: Todo,
    }),
  ),
) {}

// The server keeps todos in memory. Each time the layer is built, it starts
// with an empty list.
const TodosLive = HttpApiBuilder.group(TodoApi, 'todos', (handlers) =>
  Effect.sync(() => {
    const todos: Array<Todo> = []
    return handlers
      .handle('list', () => Effect.succeed([...todos]))
      .handle('create', ({ payload }) =>
        Effect.sync(() => {
          const todo = new Todo({ id: todos.length + 1, title: payload.title })
          todos.push(todo)
          return todo
        }),
      )
  }),
)

// An `HttpClient` that hands each request straight to the server's routes,
// so the example never touches the network. `HttpApiTest` uses the same
// trick. In an app you would pass `FetchHttpClient.layer` instead.
const InMemoryHttpClient = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const handle = yield* HttpRouter.toHttpEffect(
      HttpApiBuilder.layer(TodoApi).pipe(
        Layer.provide(TodosLive),
        Layer.provide(HttpServer.layerServices),
      ),
    )
    return HttpClient.make((request) =>
      handle.pipe(
        Effect.provideService(
          HttpServerRequest.HttpServerRequest,
          HttpServerRequest.fromClientRequest(request),
        ),
        Effect.map((response) =>
          HttpServerResponse.toClientResponse(response, { request }),
        ),
        Effect.orDie,
        Effect.scoped,
      ),
    )
  }),
)

// The client is a service class. Its atoms build their own runtime from the
// `httpClient` layer, so a component needs no further setup. `AtomHttpApi`
// is marked `@stability unstable`.
class TodoClient extends AtomHttpApi.Service<TodoClient>()('TodoClient', {
  api: TodoApi,
  httpClient: InMemoryHttpClient,
  baseUrl: 'http://todos.test',
}) {}

export const program = Effect.gen(function* () {
  // A query atom for `GET /todos`, registered under the `todos` key.
  const todoList = TodoClient.query('todos', 'list', {
    reactivityKeys: ['todos'],
  })
  // A mutation atom for `POST /todos`. Setting it sends the request.
  const createTodo = TodoClient.mutation('todos', 'create')

  const registry = AtomRegistry.make()
  const unmount = registry.mount(todoList)
  const titles = Effect.map(
    AtomRegistry.getResult(registry, todoList, { suspendOnWaiting: true }),
    (list) => list.map((todo) => todo.title),
  )

  yield* Console.log('todos:', yield* titles)

  // The mutation takes the request plus the keys to invalidate when it
  // succeeds. The list query listens on `todos`, so it reloads by itself.
  registry.set(createTodo, {
    payload: { title: 'Book flights' },
    reactivityKeys: ['todos'],
  })
  const created = yield* AtomRegistry.getResult(registry, createTodo)
  yield* Console.log(`created todo ${created.id}: ${created.title}`)
  yield* Console.log('todos:', yield* titles)

  // Reading the atom directly gives the `AsyncResult` a component renders.
  const state = registry.get(todoList)
  yield* Console.log(`list state: ${state._tag}`)
  yield* Console.log(AsyncResult.isSuccess(state) ? state.value : [])

  unmount()
  registry.dispose()
})
