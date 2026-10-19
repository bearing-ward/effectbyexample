/**
 * @title Read and write locks with TxReentrantLock
 * @difficulty advanced
 * @summary A `TxReentrantLock` lets many readers in at once, or one writer
 * alone. It is reentrant: a fiber that already holds the lock can take it
 * again without deadlocking itself.
 */

import { Console, Deferred, Effect, Fiber, Ref, TxReentrantLock } from 'effect'

export const program = Effect.gen(function* () {
  const lock = yield* TxReentrantLock.make()
  const prices = yield* Ref.make({ coffee: 3 })
  // Readers hold their lock until this gate opens, so we can inspect the
  // lock while they are inside.
  const gate = yield* Deferred.make<void>()

  // Two readers share the lock. `withReadLock` releases it when the effect
  // ends, whether it succeeds, fails, or is interrupted.
  const reader = (name: string) =>
    TxReentrantLock.withReadLock(
      lock,
      Effect.gen(function* () {
        const { coffee } = yield* Ref.get(prices)
        yield* Deferred.await(gate)
        return `${name} read coffee=${coffee}`
      }),
    )
  const readers = yield* Effect.forkChild(
    Effect.all([reader('till-1'), reader('till-2')], { concurrency: 2 }),
  )
  yield* TxReentrantLock.readLocks(lock).pipe(
    Effect.repeat({ until: (n) => n === 2 }),
  )
  yield* Console.log(
    `read locks held: ${yield* TxReentrantLock.readLocks(lock)}`,
  )

  // The writer needs exclusive access, so it waits for both readers. Its
  // wait is a transaction retry: it wakes when the lock state changes. While
  // the readers are inside, the price cannot change.
  const writer = yield* Effect.forkChild(
    TxReentrantLock.withWriteLock(
      lock,
      Ref.set(prices, { coffee: 4 }).pipe(Effect.as('price raised')),
    ),
  )
  // Give the writer plenty of turns to run. It is still waiting: the fiber
  // has no result yet, and the price is unchanged.
  yield* Effect.repeat(Effect.yieldNow, { times: 20 })
  yield* Console.log(
    `writer finished while readers hold: ${writer.pollUnsafe() !== undefined}`,
  )
  yield* Console.log(
    `price while readers hold: ${(yield* Ref.get(prices)).coffee}`,
  )

  // Opening the gate lets the readers finish. They saw the old price, and
  // the writer goes next.
  yield* Deferred.succeed(gate, undefined)
  for (const line of yield* Fiber.join(readers)) {
    yield* Console.log(line)
  }
  yield* Console.log(yield* Fiber.join(writer))
  yield* Console.log(`price now: ${(yield* Ref.get(prices)).coffee}`)

  // Reentrancy: while holding the write lock, this fiber takes it again and
  // also takes a read lock. A non-reentrant lock would wait on itself forever.
  yield* TxReentrantLock.withWriteLock(
    lock,
    TxReentrantLock.withWriteLock(
      lock,
      TxReentrantLock.withReadLock(
        lock,
        Effect.gen(function* () {
          const writes = yield* TxReentrantLock.writeLocks(lock)
          const reads = yield* TxReentrantLock.readLocks(lock)
          yield* Console.log(
            `nested: ${writes} write locks, ${reads} read lock`,
          )
        }),
      ),
    ),
  )
  yield* Console.log(
    `locked afterwards: ${yield* TxReentrantLock.locked(lock)}`,
  )
})
