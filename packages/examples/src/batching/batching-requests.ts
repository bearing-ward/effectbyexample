/**
 * @title Batching requests
 * @difficulty intermediate
 * @summary Code that loads one user at a time is easy to write, but calling
 * the database once per user is slow. With `Request` and `RequestResolver`
 * you keep writing one-at-a-time lookups, and Effect collects the lookups
 * that happen at the same moment into a single batched call.
 */

import { Console, Effect, Exit, Request, RequestResolver, Schema } from 'effect'

class UserNotFound extends Schema.TaggedError<UserNotFound>()('UserNotFound', {
  id: Schema.Number,
}) {}

// A request describes one lookup: what goes in, what comes out, and how
// it can fail. `GetUser` takes an id and returns a name or `UserNotFound`.
class GetUser extends Request.Class<
  { readonly id: number },
  string,
  UserNotFound
> {}

// A pretend users table.
const table = new Map([
  [1, 'Ada'],
  [2, 'Grace'],
  [3, 'Alan'],
])

export const program = Effect.gen(function* () {
  // Count how often we "query" the table.
  let queries = 0

  // The resolver receives every pending request at once. It makes one call
  // for all of them, like `SELECT * FROM users WHERE id IN (...)`, then
  // completes each entry with its own result: `Exit.succeed` with the
  // name, or `Exit.fail` when the user is missing.
  const usersResolver = RequestResolver.make<GetUser>((entries) =>
    Effect.gen(function* () {
      queries++
      const ids = entries.map((entry) => entry.request.id)
      yield* Console.log(`query: id in (${ids.join(', ')})`)
      for (const entry of entries) {
        const name = table.get(entry.request.id)
        entry.completeUnsafe(
          name === undefined
            ? Exit.fail(new UserNotFound({ id: entry.request.id }))
            : Exit.succeed(name),
        )
      }
    }),
  )

  // Callers see an ordinary function that loads one user.
  const getUser = (id: number) =>
    Effect.request(new GetUser({ id }), usersResolver)

  // Lookups that run one after another cannot be batched: each waits for
  // the previous one. That is one query per user.
  yield* Effect.forEach([1, 2, 3], getUser)
  yield* Console.log(`sequential: ${queries} queries`)

  // Run the same lookups concurrently and they are all pending at once, so
  // the resolver gets them in one batch.
  queries = 0
  const names = yield* Effect.forEach([1, 2, 3], getUser, {
    concurrency: 'unbounded',
  })
  yield* Console.log(names, `concurrent: ${queries} query`)

  // A failing lookup in the batch fails only its caller. Here we turn each
  // result into an `Exit` to see them side by side.
  const results = yield* Effect.forEach(
    [1, 99, 3],
    (id) => Effect.exit(getUser(id)),
    {
      concurrency: 'unbounded',
    },
  )
  yield* Console.log(
    results.map((exit) => (Exit.isSuccess(exit) ? exit.value : 'not found')),
  )
})
