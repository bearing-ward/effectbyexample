/**
 * @title Forking, joining and interrupting fibers
 * @difficulty intermediate
 * @summary A fiber is a lightweight thread of Effect work. Forking starts an
 * effect in a new fiber and returns at once; joining waits for its result;
 * interrupting stops it and runs its cleanup. Child fibers never outlive
 * the fiber that started them.
 */

import { Console, Effect, Exit, Fiber } from 'effect'

// A report that takes a while to build.
const buildReport = Effect.gen(function* () {
  yield* Effect.sleep('20 millis')
  return { orders: 42 }
})

// A job that never finishes on its own, like a file watcher.
const watchUploads = (name: string) =>
  Effect.never.pipe(Effect.onInterrupt(() => Console.log(`${name}: stopped`)))

export const program = Effect.gen(function* () {
  // `Effect.forkChild` starts the effect and returns a `Fiber` right away,
  // so we can do other work meanwhile.
  const report = yield* Effect.forkChild(buildReport)
  yield* Console.log('report started, doing other work')

  // `Fiber.join` waits for the fiber and returns its value, or fails with
  // its error.
  yield* Console.log('report:', yield* Fiber.join(report))

  // `Fiber.await` waits too, but returns an `Exit`, so a failure arrives
  // as a value instead of failing the caller.
  const broken = yield* Effect.forkChild(Effect.fail('no data for March'))
  const exit = yield* Fiber.await(broken)
  yield* Console.log('broken report failed:', Exit.isFailure(exit))

  // `Fiber.interrupt` stops a fiber. It waits until the fiber's cleanup
  // has run, so "stopped" prints before the next line. `Effect.yieldNow`
  // first gives the new fiber a chance to start.
  const watcher = yield* Effect.forkChild(watchUploads('watcher'))
  yield* Effect.yieldNow
  yield* Fiber.interrupt(watcher)
  yield* Console.log('watcher interrupted')

  // A child fiber is tied to its parent. When the parent fiber finishes,
  // any children still running are interrupted, so fibers do not leak.
  const parent = yield* Effect.forkChild(
    Effect.gen(function* () {
      yield* Effect.forkChild(watchUploads('child'))
      yield* Effect.yieldNow
      yield* Console.log('parent done')
    }),
  )
  yield* Fiber.join(parent)
  yield* Console.log('after parent')
})
