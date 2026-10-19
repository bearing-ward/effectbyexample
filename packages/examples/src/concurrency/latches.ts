/**
 * @title Gating work with a Latch
 * @difficulty intermediate
 * @summary A `Latch` is a gate. While it is closed, fibers that reach it
 * wait; opening it lets them all through. Unlike a `Deferred`, a latch can
 * be closed again, which makes it a good fit for pausing and resuming work.
 */

import { Console, Effect, Fiber, Latch, Ref } from 'effect'

export const program = Effect.gen(function* () {
  // The warehouse starts closed for stock-taking.
  const warehouseOpen = yield* Latch.make(false)
  const shipped = yield* Ref.make<Array<string>>([])

  // `Latch.whenOpen` waits at the gate, then runs the effect.
  const ship = (order: string) =>
    Latch.whenOpen(
      warehouseOpen,
      Ref.update(shipped, (orders) => [...orders, order]),
    )

  // Three orders arrive while the gate is closed. They wait.
  const morning = yield* Effect.forkChild(
    Effect.all([ship('A-1'), ship('A-2'), ship('A-3')], {
      concurrency: 'unbounded',
    }),
  )
  yield* Effect.yieldNow
  yield* Console.log('shipped while closed:', yield* Ref.get(shipped))

  // `Latch.open` releases every waiter, and later arrivals pass straight
  // through while it stays open.
  yield* Latch.open(warehouseOpen)
  yield* Fiber.join(morning)
  yield* ship('B-1')
  yield* Console.log('shipped after opening:', yield* Ref.get(shipped))

  // `Latch.close` shuts the gate again for the night.
  yield* Latch.close(warehouseOpen)
  yield* Ref.set(shipped, [])
  const night = yield* Effect.forkChild(ship('C-1'))
  yield* Effect.yieldNow
  yield* Console.log('shipped at night:', yield* Ref.get(shipped))

  // `Latch.release` lets the fibers already waiting through once, without
  // opening the gate for anyone who comes later.
  yield* Latch.release(warehouseOpen)
  yield* Fiber.join(night)
  yield* Console.log('after release:', yield* Ref.get(shipped))
  yield* Console.log('open now?', Latch.isOpen(warehouseOpen))
})
