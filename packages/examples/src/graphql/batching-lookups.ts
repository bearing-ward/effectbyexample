/**
 * @title Batching lookups
 * @difficulty advanced
 * @summary Looking up ten users by id should not cost ten requests.
 * `GraphQLResolver` collects concurrent lookups into one query against a
 * field that takes a list of ids, then hands each caller its own entry.
 */

// Resolvers build on `RequestResolver` from `effect`. For APIs with no field
// that takes a list of keys, `GraphQLResolver.aliased` repeats one
// operation under aliases in a single request instead.
import { Cause, Console, Effect, Layer, Schema, Stream } from 'effect'
import {
  GraphQL,
  GraphQLClient,
  GraphQLGroup,
  GraphQLProtocol,
  GraphQLResolver,
} from 'effect/graphql'

// `users(ids:)` returns one entry per id, in the same order, with `null`
// for an id that does not exist. That is the shape `ordered` expects.
const UsersById = GraphQL.query('UsersById', {
  document: 'query UsersById($ids:[ID!]!){users(ids:$ids){name}}',
  variables: { ids: Schema.Array(Schema.String) },
  result: Schema.Struct({
    users: Schema.Array(Schema.NullOr(Schema.Struct({ name: Schema.String }))),
  }),
})

const people: Record<string, string> = { u1: 'Ada', u2: 'Grace', u3: 'Alan' }

// The server prints the ids of every request it receives.
const ScriptedServer = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
  execute: (request) => {
    const { ids } = request.variables as { ids: Array<string> }
    return Console.log(`server: users(ids: ${ids.join(', ')})`).pipe(
      Effect.as({
        body: {
          data: {
            users: ids.map((id) => {
              const name = people[id]
              return name === undefined ? null : { name }
            }),
          },
        },
      }),
    )
  },
  subscribe: () => Stream.empty,
})

export const program = Effect.gen(function* () {
  const client = yield* GraphQLClient.make(GraphQLGroup.make(UsersById))

  // `ordered` says how to turn a batch of keys into variables, and where
  // the list sits in the result. `path` is type checked against the result
  // schema. `request` turns the resolver into a plain lookup function.
  const getUser = GraphQLResolver.request(
    GraphQLResolver.ordered(client.UsersById, {
      variables: (ids: ReadonlyArray<string>) => ({ ids }),
      path: ['users'],
    }),
  )

  // A `null` entry fails only that lookup, with `NoSuchElementError`.
  const nameOf = (id: string) =>
    getUser(id).pipe(
      Effect.map((user) => user.name),
      Effect.catchIf(Cause.isNoSuchElementError, () =>
        Effect.succeed('(no such user)'),
      ),
    )

  // Five concurrent lookups, one of them a repeat. The server gets a single
  // request, and the repeated id is sent once.
  const names = yield* Effect.forEach(['u1', 'u2', 'u9', 'u3', 'u1'], nameOf, {
    concurrency: 'unbounded',
  })
  yield* Console.log(names)

  // Lookups that run one after another cannot share a batch.
  yield* nameOf('u2')
  yield* nameOf('u3')
}).pipe(Effect.provide(ScriptedServer))
