/**
 * @title Typed operations
 * @difficulty intermediate
 * @summary A GraphQL operation is a document plus two schemas: one for its
 * variables and one for its result. Group operations, build a client from the
 * group, and every call encodes its variables and decodes its result for you.
 */

// The GraphQL modules live in `effect/graphql` and are marked experimental,
// so their API may still change. In a real project you write `.graphql`
// files and `graphqlgen` from `@effect/graphql-generator` writes these
// definitions for you. Here we write them by hand.
import {
  Console,
  Context,
  DateTime,
  Effect,
  Layer,
  Schema,
  Stream,
} from 'effect'
import {
  GraphQL,
  GraphQLClient,
  GraphQLGroup,
  GraphQLProtocol,
} from 'effect/graphql'

// The server sends dates as ISO strings, a custom `DateTime` scalar.
// `DateTimeUtcFromString` decodes them to `DateTime.Utc` values and encodes
// them back to strings.
const Todo = Schema.Struct({
  id: Schema.String,
  title: Schema.String,
  dueAt: Schema.DateTimeUtcFromString,
})

// A query: its name, the document sent as-is, and the two schemas.
const TodosDue = GraphQL.query('TodosDue', {
  document:
    'query TodosDue($before:DateTime!){todos(dueBefore:$before){id title dueAt}}',
  variables: { before: Schema.DateTimeUtcFromString },
  result: Schema.Struct({ todos: Schema.Array(Todo) }),
})

// A mutation has the same shape.
const CompleteTodo = GraphQL.mutation('CompleteTodo', {
  document: 'mutation CompleteTodo($id:ID!){completeTodo(id:$id){id}}',
  variables: { id: Schema.String },
  result: Schema.Struct({ completeTodo: Schema.Struct({ id: Schema.String }) }),
})

// A group is the set of operations a client exposes. The client gets one
// method per operation, named after it. Wrapping it in a service lets the
// rest of the app depend on `TodoApi` instead of on GraphQL details.
const TodoGroup = GraphQLGroup.make(TodosDue, CompleteTodo)

class TodoApi extends Context.Service<
  TodoApi,
  GraphQLClient.FromGroup<typeof TodoGroup>
>()('app/TodoApi') {
  static readonly layer = Layer.effect(TodoApi, GraphQLClient.make(TodoGroup))
}

// The client needs a `GraphQLProtocol`, the transport. In production that is
// `GraphQLProtocol.layerHttp({ url })`. This scripted one prints what it
// receives and answers with raw JSON, as a server would.
const ScriptedServer = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
  execute: (request) =>
    Console.log(
      `${request.kind} ${request.operationName}`,
      request.variables,
    ).pipe(
      Effect.as({
        body:
          request.operationName === 'TodosDue'
            ? {
                data: {
                  todos: [
                    {
                      id: 't1',
                      title: 'File taxes',
                      dueAt: '2026-04-15T00:00:00.000Z',
                    },
                  ],
                },
              }
            : { data: { completeTodo: { id: 't1' } } },
      }),
    ),
  subscribe: () => Stream.empty,
})

// The program only asks for `TodoApi`. Which transport sits underneath is
// decided by the layer it is given.
export const program = Effect.gen(function* () {
  const api = yield* TodoApi

  // The variable is a `DateTime`. It reaches the server as a string.
  const { todos } = yield* api.TodosDue({
    before: DateTime.makeUnsafe('2026-05-01T00:00:00Z'),
  })

  // The result comes back decoded: `dueAt` is a `DateTime` again, so date
  // functions work on it directly.
  for (const todo of todos) {
    yield* Console.log(todo.title, DateTime.formatIsoDate(todo.dueAt))
  }

  const done = yield* api.CompleteTodo({ id: 't1' })
  yield* Console.log(`completed ${done.completeTodo.id}`)
}).pipe(Effect.provide(TodoApi.layer.pipe(Layer.provide(ScriptedServer))))
