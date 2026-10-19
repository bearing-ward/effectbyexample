/**
 * @title Paging through connections
 * @difficulty intermediate
 * @summary Most GraphQL APIs page lists with cursor connections:
 * `pageInfo { hasNextPage endCursor }` plus an `after` variable.
 * `GraphQLClient.items` turns such a query into a stream that fetches the
 * next page only when you pull for more.
 */

// Paging needs nothing beyond the client and `Stream`.
import { Console, Effect, Layer, Schema, Stream } from 'effect'
import {
  GraphQL,
  GraphQLClient,
  GraphQLGroup,
  GraphQLProtocol,
} from 'effect/graphql'

// The operation must declare an optional `after` variable. The helper
// leaves it out on the first page and sends the previous `endCursor` after
// that. Without one, the call is a type error.
const Issues = GraphQL.query('Issues', {
  document:
    'query Issues($after:String){issues(first:2,after:$after){pageInfo{hasNextPage endCursor}nodes{number title}}}',
  variables: { after: Schema.optional(Schema.NullOr(Schema.String)) },
  result: Schema.Struct({
    issues: Schema.Struct({
      pageInfo: Schema.Struct({
        hasNextPage: Schema.Boolean,
        endCursor: Schema.NullOr(Schema.String),
      }),
      nodes: Schema.Array(
        Schema.Struct({ number: Schema.Int, title: Schema.String }),
      ),
    }),
  }),
})

// Six issues, served two per page. The cursor is the index to start from.
const titles = ['Typo', 'Crash', 'Slow', 'Docs', 'Leak', 'Flaky']

const ScriptedServer = Layer.succeed(GraphQLProtocol.GraphQLProtocol, {
  execute: (request) => {
    const { after } = request.variables as { after?: string }
    const start = after === undefined ? 0 : Number(after)
    const nodes = titles
      .slice(start, start + 2)
      .map((title, i) => ({ number: start + i + 1, title }))
    const hasNextPage = start + 2 < titles.length
    return Console.log(`server: page after ${after ?? 'start'}`).pipe(
      Effect.as({
        body: {
          data: {
            issues: {
              pageInfo: { hasNextPage, endCursor: String(start + 2) },
              nodes,
            },
          },
        },
      }),
    )
  },
  subscribe: () => Stream.empty,
})

export const program = Effect.gen(function* () {
  const client = yield* GraphQLClient.make(GraphQLGroup.make(Issues))

  // `connection` points at the connection inside each result. The stream
  // emits its `nodes` one by one, across pages.
  const issues = GraphQLClient.items(client.Issues, {
    variables: {},
    connection: (result) => result.issues,
  })

  // We only want the first three. That needs two pages, so the server
  // never sees a request for the third.
  const firstThree = yield* issues.pipe(
    Stream.take(3),
    Stream.map((issue) => `#${issue.number} ${issue.title}`),
    Stream.runCollect,
  )
  yield* Console.log(firstThree)

  // `GraphQLClient.pages` emits whole connections instead, one per page.
  const pageCount = yield* GraphQLClient.pages(client.Issues, {
    variables: {},
    connection: (result) => result.issues,
  }).pipe(Stream.runCount)
  yield* Console.log(`pages: ${pageCount}`)
}).pipe(Effect.provide(ScriptedServer))
