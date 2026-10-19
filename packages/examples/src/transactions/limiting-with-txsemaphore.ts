/**
 * @title Limiting concurrency with TxSemaphore
 * @difficulty intermediate
 * @summary A `TxSemaphore` holds a fixed number of permits. Work that needs a
 * permit waits until one is free. Because the permits live in a `TxRef`, you
 * can also take permits inside a larger transaction.
 */

import {
  Console,
  Deferred,
  Effect,
  Fiber,
  Ref,
  TxRef,
  TxSemaphore,
} from 'effect'

export const program = Effect.gen(function* () {
  // The upload service allows two uploads at once.
  const permits = yield* TxSemaphore.make(2)
  const active = yield* Ref.make(0)
  const mostAtOnce = yield* Ref.make(0)
  // The uploads hold their permits until we open this gate, so we can look
  // at the semaphore while it is busy.
  const gate = yield* Deferred.make<void>()

  // `withPermit` takes a permit, runs the effect, and returns the permit
  // afterwards, even if the effect fails or is interrupted.
  const upload = (file: string) =>
    TxSemaphore.withPermit(
      permits,
      Effect.gen(function* () {
        const now = yield* Ref.updateAndGet(active, (n) => n + 1)
        yield* Ref.update(mostAtOnce, (most) => Math.max(most, now))
        yield* Deferred.await(gate)
        yield* Ref.update(active, (n) => n - 1)
        return file
      }),
    )

  const uploads = yield* Effect.forkChild(
    Effect.forEach(['a.png', 'b.png', 'c.png'], upload, {
      concurrency: 'unbounded',
    }),
  )

  // Wait until both permits are in use. The third upload is parked.
  yield* Ref.get(active).pipe(Effect.repeat({ until: (n) => n === 2 }))
  yield* Console.log(`available: ${yield* TxSemaphore.available(permits)}`)

  // `tryAcquire` does not wait. It reports `false` when no permit is free.
  yield* Console.log(`try now: ${yield* TxSemaphore.tryAcquire(permits)}`)

  yield* Deferred.succeed(gate, undefined)
  yield* Console.log(`uploaded: ${(yield* Fiber.join(uploads)).join(', ')}`)
  yield* Console.log(`most at once: ${yield* Ref.get(mostAtOnce)}`)

  // The permits are transactional state. A batch job can take both permits
  // and count itself as queued in one atomic step. If the permits were not
  // free, the whole transaction would wait and the counter would not move.
  const batchesQueued = yield* TxRef.make(0)
  yield* Effect.tx(
    Effect.gen(function* () {
      yield* TxSemaphore.acquireN(permits, 2)
      yield* TxRef.update(batchesQueued, (n) => n + 1)
    }),
  )
  yield* Console.log(
    `batch holds ${2 - (yield* TxSemaphore.available(permits))} permits,`,
    `batches queued: ${yield* TxRef.get(batchesQueued)}`,
  )
  yield* TxSemaphore.releaseN(permits, 2)
  yield* Console.log(
    `available again: ${yield* TxSemaphore.available(permits)}`,
  )
})
