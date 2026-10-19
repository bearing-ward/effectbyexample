/**
 * @title Managing background fibers
 * @difficulty advanced
 * @summary Forked fibers need an owner, or they leak. `FiberHandle` holds
 * at most one fiber, `FiberMap` one fiber per key, and `FiberSet` any
 * number. Each lives in a scope and interrupts its fibers when the scope
 * closes.
 */

import { Console, Effect, FiberHandle, FiberMap, FiberSet } from 'effect'

// A long-running job that reports when it is stopped early.
const job = (name: string) =>
  Effect.never.pipe(
    Effect.onInterrupt(() => Console.log(`  ${name}: interrupted`)),
  )

export const program = Effect.gen(function* () {
  // `FiberHandle` suits "only the latest one matters", like search as you
  // type. Running a new fiber interrupts the one before it.
  yield* Console.log('FiberHandle')
  const search = yield* FiberHandle.make()
  yield* FiberHandle.run(search, job('search "c"'))
  yield* FiberHandle.run(search, job('search "ch"'))
  yield* FiberHandle.run(search, job('search "chair"'))
  yield* Effect.yieldNow
  // `clear` interrupts whatever is running now, here the last search.
  yield* FiberHandle.clear(search)

  // `FiberMap` keeps one fiber per key, such as a sync job per account.
  // A new fiber for a key replaces the old one, unless you pass
  // `onlyIfMissing`, which keeps the running one instead.
  yield* Console.log('FiberMap')
  const syncs = yield* FiberMap.make<string>()
  yield* FiberMap.run(syncs, 'ada', job('sync ada #1'))
  yield* FiberMap.run(syncs, 'grace', job('sync grace'))
  yield* Effect.yieldNow
  yield* FiberMap.run(syncs, 'ada', job('sync ada #2'))
  yield* FiberMap.run(syncs, 'ada', job('sync ada #3'), { onlyIfMissing: true })
  yield* Console.log('  running:', yield* FiberMap.size(syncs))

  // `FiberSet` is a bag of fire-and-forget fibers. Finished fibers remove
  // themselves, and `awaitEmpty` waits until all of them are done.
  yield* Console.log('FiberSet')
  const emails = yield* FiberSet.make()
  for (const to of ['ada', 'grace', 'alan']) {
    yield* FiberSet.run(emails, Effect.succeed(`email to ${to}`))
  }
  yield* FiberSet.awaitEmpty(emails)
  yield* Console.log(
    '  emails sent, left in set:',
    yield* FiberSet.size(emails),
  )

  // One fiber the set will not see finish: it is still running when the
  // program ends.
  yield* FiberSet.run(emails, job('newsletter'))
  yield* Effect.yieldNow
  yield* Console.log('closing scope')
}).pipe(
  // Closing the scope interrupts every fiber still owned by the handle,
  // the map and the set.
  Effect.scoped,
)
