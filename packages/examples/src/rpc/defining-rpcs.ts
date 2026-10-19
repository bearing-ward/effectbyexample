/**
 * @title Defining RPCs
 * @difficulty beginner
 * @summary An RPC is a named request with a payload schema and a success
 * schema. Group RPCs together, implement each one as a handler, and call them
 * through a typed client. `RpcTest` connects the client to the handlers in
 * memory, so you can try it without a server.
 */

// The RPC modules live in `effect/rpc` and are marked unstable, so their API
// may change in a minor Effect release.
import { Console, Effect, Schema } from 'effect'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'

class Todo extends Schema.Class<Todo>('Todo')({
  id: Schema.Number,
  title: Schema.String,
  done: Schema.Boolean,
}) {}

// `Rpc.make` names a request and describes it with schemas. Passing fields to
// `payload` builds a struct for you. Leave `success` out for an RPC that
// returns nothing.
const ListTodos = Rpc.make('ListTodos', {
  success: Schema.Array(Todo),
})
const AddTodo = Rpc.make('AddTodo', {
  payload: { title: Schema.String },
  success: Todo,
})

// A group collects the RPCs that a server offers. The client and the server
// both import this one value, so they cannot drift apart.
class TodoRpcs extends RpcGroup.make(ListTodos, AddTodo) {}

// `toLayer` takes one handler per RPC, keyed by its tag. Here the layer keeps
// its todos in memory. TypeScript checks every payload and return type.
const TodoHandlers = TodoRpcs.toLayer(
  Effect.gen(function* () {
    const todos: Array<Todo> = []
    return TodoRpcs.of({
      ListTodos: () => Effect.succeed(todos),
      AddTodo: ({ title }) =>
        Effect.sync(() => {
          const todo = new Todo({ id: todos.length + 1, title, done: false })
          todos.push(todo)
          return todo
        }),
    })
  }),
)

export const program = Effect.gen(function* () {
  // `RpcTest.makeClient` builds a client wired straight to the handlers. A
  // real client would talk to a server over HTTP, a WebSocket, or a worker.
  const client = yield* RpcTest.makeClient(TodoRpcs)

  // The client has one method per RPC, named after its tag.
  const milk = yield* client.AddTodo({ title: 'Buy milk' })
  yield* client.AddTodo({ title: 'Walk the dog' })
  yield* Console.log(milk)

  const todos = yield* client.ListTodos()
  yield* Console.log(todos.map((todo) => todo.title))
}).pipe(Effect.provide(TodoHandlers), Effect.scoped)
