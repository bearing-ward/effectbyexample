/**
 * @title Defining an API
 * @difficulty beginner
 * @summary `HttpApi` describes an HTTP API as data: endpoints with schemas for
 * their path, query, body, and responses. You write the description once, then
 * implement it on the server and call it from a typed client.
 */

// The `effect/http-api` modules are marked unstable: their API may change in
// a minor Effect release.
import { Console, Effect, Layer, Ref, Schema } from 'effect'
import { HttpServer } from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiTest,
} from 'effect/http-api'

const Todo = Schema.Struct({
  id: Schema.Int,
  title: Schema.String,
  done: Schema.Boolean,
})

// An endpoint has a name, a method, and a path. Its schemas say what goes in
// and what comes out. `params` are path segments and `query` is the query
// string. Both arrive as strings, so the endpoint decodes them from their
// string form: `Schema.Boolean` accepts `"true"` and `Schema.Int` accepts
// `"2"`.
const TodosGroup = HttpApiGroup.make('todos').add(
  HttpApiEndpoint.get('list', '/todos', {
    query: { done: Schema.optional(Schema.Boolean) },
    success: Schema.Array(Todo),
  }),
  HttpApiEndpoint.get('getById', '/todos/:id', {
    params: { id: Schema.Int },
    success: Todo,
  }),
  // A schema as the `payload` of a POST becomes a JSON body. A plain record
  // of fields, like `query` above, would be sent as a URL-encoded form.
  HttpApiEndpoint.post('create', '/todos', {
    payload: Schema.Struct({ title: Schema.String }),
    success: Todo,
  }),
)

// An API is a set of groups. This value holds no server code, so a browser
// client can import it without pulling in the handlers.
const Api = HttpApi.make('todo-api').add(TodosGroup)

// `HttpApiBuilder.group` implements one group. `handleAll` must cover every
// endpoint, and each handler receives already decoded input.
const TodosLive = HttpApiBuilder.group(
  Api,
  'todos',
  Effect.fn(function* (handlers) {
    const todos = yield* Ref.make([
      { id: 1, title: 'Buy milk', done: true },
      { id: 2, title: 'Walk the dog', done: false },
    ])
    return handlers.handleAll({
      list: ({ query }) =>
        Ref.get(todos).pipe(
          Effect.map((all) =>
            query.done === undefined
              ? all
              : all.filter((todo) => todo.done === query.done),
          ),
        ),
      getById: ({ params }) =>
        Ref.get(todos).pipe(
          Effect.map((all) => all.find((todo) => todo.id === params.id)),
          Effect.flatMap(Effect.fromNullishOr),
          Effect.orDie,
        ),
      create: ({ payload }) =>
        Ref.modify(todos, (all) => {
          const todo = { id: all.length + 1, title: payload.title, done: false }
          return [todo, [...all, todo]]
        }),
    })
  }),
)

export const program = Effect.gen(function* () {
  // `HttpApiTest.groups` gives a typed client wired straight to the
  // handlers. Requests still go through routing, encoding, and decoding,
  // but no server starts.
  const client = yield* HttpApiTest.groups(Api, ['todos'])

  // The client mirrors the definition: `client.<group>.<endpoint>`.
  const created = yield* client.todos.create({
    payload: { title: 'Water the plants' },
  })
  yield* Console.log('created', created)

  // The query value is a real boolean here. The client encodes it as
  // `?done=false` and the server decodes it back.
  const open = yield* client.todos.list({ query: { done: false } })
  yield* Console.log(
    'open',
    open.map((todo) => todo.title),
  )

  const first = yield* client.todos.getById({ params: { id: 1 } })
  yield* Console.log('first', first)
}).pipe(
  // `HttpServer.layerServices` supplies the platform services the HTTP
  // pipeline needs, such as ETag generation.
  Effect.provide(Layer.mergeAll(TodosLive, HttpServer.layerServices)),
  Effect.scoped,
)
