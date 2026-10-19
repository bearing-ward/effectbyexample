/**
 * @title Deduplicating and caching requests
 * @difficulty intermediate
 * @summary When many items point at the same record, like comments by the
 * same author, a batch can ask for the same id several times. Wrapping a
 * resolver with `RequestResolver.withCache` removes the duplicates and
 * remembers results, so later lookups for the same request skip the call.
 */

import { Console, Effect, Exit, Request, RequestResolver } from 'effect'

// Requests are compared by value: two `GetAuthor` requests with the same
// id are equal. That is what lets the cache recognise a repeat.
class GetAuthor extends Request.Class<{ readonly id: number }, string> {}

const authors = new Map([
  [1, 'Ada'],
  [2, 'Grace'],
  [3, 'Alan'],
])

const comments = [
  { text: 'Great post', author: 1 },
  { text: 'Agreed', author: 2 },
  { text: 'One more thing', author: 1 },
  { text: 'Thanks!', author: 3 },
  { text: 'See above', author: 2 },
]

export const program = Effect.gen(function* () {
  // The resolver prints the ids it was asked for, so we can see each call.
  const authorsResolver = RequestResolver.make<GetAuthor>((entries) =>
    Effect.gen(function* () {
      yield* Console.log(
        `query: id in (${entries.map((e) => e.request.id).join(', ')})`,
      )
      for (const entry of entries) {
        entry.completeUnsafe(
          Exit.succeed(authors.get(entry.request.id) ?? 'unknown'),
        )
      }
    }),
  )

  // Render each comment with its author, all at once.
  const render = (resolver: RequestResolver.RequestResolver<GetAuthor>) =>
    Effect.forEach(
      comments,
      (comment) =>
        Effect.request(new GetAuthor({ id: comment.author }), resolver).pipe(
          Effect.map((name) => `${name}: ${comment.text}`),
        ),
      { concurrency: 'unbounded' },
    )

  // A plain resolver batches, but it receives every request, duplicates
  // included. Five comments mean five ids in the query.
  yield* render(authorsResolver)

  // `withCache` returns an effect, because the cache is created when it
  // runs. Keep the cached resolver and reuse it: each copy has its own
  // cache. `capacity` bounds how many results it keeps; the least recently
  // used ones are dropped first. Entries never expire, and failures are
  // cached like successes. For a time-to-live, see `RequestResolver.asCache`.
  const cached = yield* RequestResolver.withCache(authorsResolver, {
    capacity: 100,
  })

  // Now the batch contains each author once, and every comment still gets
  // its name.
  const lines = yield* render(cached)
  yield* Console.log(lines)

  // A later page needs authors 1 and 4. Author 1 comes from the cache, so
  // the query only asks for 4.
  const later = yield* Effect.forEach(
    [1, 4],
    (id) => Effect.request(new GetAuthor({ id }), cached),
    { concurrency: 'unbounded' },
  )
  yield* Console.log(later)

  // Rendering the first page again makes no query at all.
  yield* render(cached)
  yield* Console.log('rendered again without a query')
})
