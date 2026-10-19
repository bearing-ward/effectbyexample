/**
 * @title Errors and partial data
 * @difficulty intermediate
 * @summary Every client method fails with one error type,
 * `GraphQLClientError`. Its `reason` says what went wrong: the server
 * answered with `errors`, the data did not match the schema, the variables
 * were invalid, or the request never got an answer.
 */

// `GraphQLClientError` holds the error class and its five reasons.
import { Console, Effect, Layer, Schema, Stream } from 'effect'
import {
  GraphQL,
  GraphQLClient,
  GraphQLClientError,
  GraphQLGroup,
  GraphQLProtocol,
} from 'effect/graphql'

// The `name` variable must not be empty. That check runs before anything
// is sent.
const Repo = GraphQL.query('Repo', {
  document: 'query Repo($name:String!){repository(name:$name){stars}}',
  variables: { name: Schema.NonEmptyString },
  result: Schema.Struct({
    repository: Schema.NullOr(Schema.Struct({ stars: Schema.Int })),
  }),
})

// One scripted server, a different answer per repository name.
const ScriptedServer = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
  execute: (request) => {
    const { name } = request.variables as { name: string }
    switch (name) {
      case 'missing':
        // A GraphQL error. Its `path` names the field it belongs to.
        return Effect.succeed({
          status: 200,
          body: {
            data: { repository: null },
            errors: [{ message: 'Not found', path: ['repository'] }],
          },
        })
      case 'broken':
        // Data that does not match the result schema.
        return Effect.succeed({
          body: { data: { repository: { stars: 'many' } } },
        })
      case 'busy':
        // No GraphQL answer at all, as when a gateway returns a 503.
        return Effect.fail(
          new GraphQLClientError.TransportError({
            description: 'Service Unavailable',
            status: 503,
          }),
        )
      default:
        return Effect.succeed({ body: { data: { repository: { stars: 42 } } } })
    }
  },
  subscribe: () => Stream.empty,
})

export const program = Effect.gen(function* () {
  const client = yield* GraphQLClient.make(GraphQLGroup.make(Repo))

  // Turn each outcome into a line: the stars, or the reason it failed and
  // whether it is worth retrying.
  const describe = (name: string) =>
    client.Repo({ name }).pipe(
      Effect.map((result) => `${result.repository?.stars} stars`),
      Effect.catchTag('GraphQLClientError', (error) =>
        Effect.succeed(`${error.reason._tag}, retryable: ${error.isRetryable}`),
      ),
      Effect.map((line) => `${JSON.stringify(name)}: ${line}`),
    )

  // The empty name fails the `NonEmptyString` check while encoding the
  // variables, so nothing is sent: an `EncodeError`.
  for (const name of ['effect', 'missing', 'broken', 'busy', '']) {
    yield* Console.log(yield* describe(name))
  }

  // The client never retries on its own. Retry with `Effect.retry`, and
  // only while the error says it is retryable. A real policy would also add
  // a backoff schedule and respect `error.retryAfter`.
  const retried = yield* client.Repo({ name: 'busy' }).pipe(
    Effect.tapError(() => Console.log('busy, will retry')),
    Effect.retry({ while: (error) => error.isRetryable, times: 2 }),
    Effect.as('ok'),
    Effect.catchTag('GraphQLClientError', (error) =>
      Effect.succeed(`gave up: ${error.reason._tag}`),
    ),
  )
  yield* Console.log(retried)

  // A response can carry data and errors together. By default the call
  // fails, because a `null` caused by an error looks like a real `null`.
  // With `partial: true` you get both and decide yourself.
  const { data, errors } = yield* client.Repo(
    { name: 'missing' },
    { partial: true },
  )
  yield* Console.log(
    data,
    errors.map((error) => error.path),
  )
}).pipe(Effect.provide(ScriptedServer))
