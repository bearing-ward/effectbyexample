/**
 * @title Testing with layerTest
 * @difficulty intermediate
 * @summary Code that depends on a GraphQL client service can be tested
 * without a server. `GraphQLClient.layerTest` builds the service from one
 * handler per operation, and the code under test does not change.
 */

// The operations and the group are the same ones the real client uses.
import { Console, Context, DateTime, Effect, Layer, Schema } from 'effect'
import { GraphQL, GraphQLClient, GraphQLGroup } from 'effect/graphql'

const TodosDue = GraphQL.query('TodosDue', {
  document:
    'query TodosDue($before:DateTime!){todos(dueBefore:$before){title}}',
  variables: { before: Schema.DateTimeUtcFromString },
  result: Schema.Struct({
    todos: Schema.Array(Schema.Struct({ title: Schema.String })),
  }),
})

const CompleteTodo = GraphQL.mutation('CompleteTodo', {
  document: 'mutation CompleteTodo($id:ID!){completeTodo(id:$id){id}}',
  variables: { id: Schema.String },
  result: Schema.Struct({ completeTodo: Schema.Struct({ id: Schema.String }) }),
})

const TodoGroup = GraphQLGroup.make(TodosDue, CompleteTodo)

// The service keeps its real layer, and binds `layerTest` to its group once,
// as a static helper. The group fixes
// the operation types, so each handler is checked against its operation.
class TodoApi extends Context.Service<
  TodoApi,
  GraphQLClient.FromGroup<typeof TodoGroup>
>()('app/TodoApi') {
  static readonly layer = Layer.effect(TodoApi, GraphQLClient.make(TodoGroup))
  static readonly layerTest = GraphQLClient.layerTest(TodoApi, TodoGroup)
}

// The code under test only knows about the `TodoApi` service.
const dueThisWeek = TodoApi.use((api) =>
  api.TodosDue({ before: DateTime.makeUnsafe('2026-05-08T00:00:00Z') }),
).pipe(Effect.map(({ todos }) => todos.map((todo) => todo.title)))

// Handlers are keyed by operation name. They get the caller's variables in
// their decoded form, and return a decoded result. Nothing is encoded, so
// `before` is still a `DateTime` here, not a string.
const TodoApiTest = TodoApi.layerTest({
  TodosDue: ({ before }) =>
    Console.log(`handler got ${DateTime.formatIsoDate(before)}`).pipe(
      Effect.as({ todos: [{ title: 'File taxes' }, { title: 'Call mum' }] }),
    ),
})

// Provide the test layer instead of the real one. The code under test runs
// unchanged.
export const program = Effect.gen(function* () {
  yield* Console.log(yield* dueThisWeek)

  // We gave no handler for `CompleteTodo`. Calling it dies with a defect
  // instead of failing, so an `Effect.catch` in the code under test cannot
  // swallow a missing stub by accident.
  const missing = yield* TodoApi.use((api) =>
    api.CompleteTodo({ id: 't1' }),
  ).pipe(
    Effect.as('completed'),
    Effect.catchDefect((defect) => Effect.succeed(String(defect))),
  )
  yield* Console.log(missing)
}).pipe(Effect.provide(TodoApiTest))
