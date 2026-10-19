/**
 * @title Pooling connections
 * @difficulty intermediate
 * @summary Opening a connection is slow, and a database allows only so many.
 * A `Pool` keeps a fixed number of them open and lends them out. When every
 * item is busy, the next borrower waits for one to come back instead of
 * opening another.
 */

import { Console, Effect, Pool, Ref } from 'effect'

export const program = Effect.gen(function* () {
  const opened = yield* Ref.make(0)
  const inUse = yield* Ref.make(0)
  const mostInUse = yield* Ref.make(0)

  // `acquire` describes how to open one item. Here it is a scoped resource,
  // so the pool also knows how to close it.
  const openConnection = Effect.acquireRelease(
    Ref.updateAndGet(opened, (n) => n + 1).pipe(Effect.map((n) => ({ id: n }))),
    () => Ref.update(opened, (n) => n - 1),
  )

  // `Pool.make` with `size: 2` keeps exactly two connections. The pool
  // lives in a scope, and closing that scope closes the connections.
  yield* Effect.scoped(
    Effect.gen(function* () {
      const pool = yield* Pool.make({ acquire: openConnection, size: 2 })

      // A query borrows a connection with `Pool.use` and gives it back when
      // the effect ends, even if it fails. We count how many are borrowed
      // at once.
      const query = (orderId: number) =>
        Pool.use(pool, (_connection) =>
          Effect.gen(function* () {
            const now = yield* Ref.updateAndGet(inUse, (n) => n + 1)
            yield* Ref.update(mostInUse, (most) => Math.max(most, now))
            yield* Effect.yieldNow
            yield* Ref.update(inUse, (n) => n - 1)
            return `order ${orderId} loaded`
          }),
        )

      // Six queries start at once. Only two can hold a connection at a
      // time; the other four wait their turn.
      const results = yield* Effect.forEach([1, 2, 3, 4, 5, 6], query, {
        concurrency: 'unbounded',
      })
      yield* Console.log(results)
      yield* Console.log('connections open:', yield* Ref.get(opened))
      yield* Console.log('most borrowed at once:', yield* Ref.get(mostInUse))
    }),
  )

  yield* Console.log('after the scope:', yield* Ref.get(opened))
})
