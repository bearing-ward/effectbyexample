/**
 * @title Limiting work with semaphores
 * @difficulty intermediate
 * @summary A `Semaphore` holds a fixed number of permits. Work takes a
 * permit before it starts and gives it back when it ends, so no more than
 * that many run at once, across every part of the program that shares it.
 * `PartitionedSemaphore`, marked unstable, also shares permits fairly
 * between groups such as tenants.
 */

import {
  Console,
  Effect,
  Fiber,
  PartitionedSemaphore,
  Ref,
  Semaphore,
} from 'effect'

export const program = Effect.gen(function* () {
  // The email provider allows two connections at a time.
  const smtp = yield* Semaphore.make(2)
  const active = yield* Ref.make(0)
  const peak = yield* Ref.make(0)

  const deliver = Effect.gen(function* () {
    const now = yield* Ref.updateAndGet(active, (n) => n + 1)
    yield* Ref.update(peak, (most) => Math.max(most, now))
    yield* Effect.yieldNow
    yield* Ref.update(active, (n) => n - 1)
  })

  // `withPermit` wraps an effect so it holds one permit while it runs.
  const send = (_to: string) => deliver.pipe(Semaphore.withPermit(smtp))

  // Welcome emails and receipts are sent by different code, each with no
  // limit of its own. The shared semaphore still caps the total at two.
  yield* Effect.all(
    [
      Effect.forEach(['ada', 'grace', 'alan'], send, {
        concurrency: 'unbounded',
      }),
      Effect.forEach(['linus', 'barbara'], send, { concurrency: 'unbounded' }),
    ],
    { concurrency: 'unbounded' },
  )
  yield* Console.log('most emails at once:', yield* Ref.get(peak))

  // `withPermits(n)` takes several permits. A bulk send that needs both
  // waits for the connections to free up and then runs alone. Permits are
  // not reentrant: wrapping `send`, which already holds one, would need
  // three and wait forever.
  yield* deliver.pipe(Semaphore.withPermits(smtp, 2))
  yield* Console.log('newsletter sent')

  // A plain semaphore serves waiters first come, first served. When one
  // tenant floods it, others wait behind the whole backlog. To see the
  // order, we hold the only permit while the jobs queue up, then let go.
  // `acme` queues four jobs and `globex` two.
  const jobs = ['acme-1', 'acme-2', 'acme-3', 'acme-4', 'globex-1', 'globex-2']
  const order: Array<string> = []
  const record = (job: string) => Effect.sync(() => order.push(job))

  const fifo = yield* Semaphore.make(1)
  yield* Semaphore.take(fifo, 1)
  const plain = yield* Effect.forkChild(
    Effect.forEach(
      jobs,
      (job) => record(job).pipe(Semaphore.withPermit(fifo)),
      {
        concurrency: 'unbounded',
      },
    ),
  )
  yield* Effect.yieldNow
  yield* Semaphore.release(fifo, 1)
  yield* Fiber.join(plain)
  yield* Console.log('plain:      ', order.splice(0).join(' '))

  // A `PartitionedSemaphore` takes a key with each request and hands
  // released permits to the waiting keys in turn, so `globex` is not stuck
  // behind all of `acme`.
  const fair = yield* PartitionedSemaphore.make<string>({ permits: 1 })
  yield* PartitionedSemaphore.take(fair, 'setup', 1)
  const partitioned = yield* Effect.forkChild(
    Effect.forEach(
      jobs,
      (job) => {
        const tenant = job.split('-')[0] ?? job
        return record(job).pipe(PartitionedSemaphore.withPermit(fair, tenant))
      },
      { concurrency: 'unbounded' },
    ),
  )
  yield* Effect.yieldNow
  yield* PartitionedSemaphore.release(fair, 1)
  yield* Fiber.join(partitioned)
  yield* Console.log('partitioned:', order.splice(0).join(' '))
})
