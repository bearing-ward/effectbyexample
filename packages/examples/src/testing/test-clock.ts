/**
 * @title Controlling time with TestClock
 * @difficulty intermediate
 * @summary Code that sleeps for an hour should not take an hour to test.
 * `TestClock` replaces the clock with a virtual one that only moves when you
 * move it, so time-based code runs instantly and in a known order.
 */

import { Clock, Console, Effect, Fiber, Ref } from 'effect'
import { TestClock } from 'effect/testing'

// The code under test: send a reminder after a one hour delay. It uses
// `Effect.sleep`, which reads the `Clock` service, so it does not know or care
// whether the clock is real.
const sendReminderLater = (sent: Ref.Ref<ReadonlyArray<string>>) =>
  Effect.gen(function* () {
    yield* Effect.sleep('1 hour')
    yield* Ref.update(sent, (all) => [...all, 'Your order ships tomorrow'])
  })

const elapsedMinutes = Clock.currentTimeMillis.pipe(
  Effect.map((millis) => `${millis / 60_000} min`),
)

const test = Effect.gen(function* () {
  // A virtual clock starts at 0, the Unix epoch.
  yield* Console.log('start:', yield* elapsedMinutes)

  // Under `TestClock`, a sleep waits until the clock is moved past its
  // deadline. Fork the code under test so this fiber stays free to move it.
  const sent = yield* Ref.make<ReadonlyArray<string>>([])
  const reminder = yield* Effect.forkChild(sendReminderLater(sent))

  // `adjust` moves time forward. Halfway there, nothing has been sent.
  yield* TestClock.adjust('30 minutes')
  yield* Console.log(yield* elapsedMinutes, yield* Ref.get(sent))

  // Crossing the deadline wakes the sleeping fiber right away. The hour
  // passes without any real waiting.
  yield* TestClock.adjust('30 minutes')
  yield* Fiber.join(reminder)
  yield* Console.log(yield* elapsedMinutes, yield* Ref.get(sent))

  // `setTime` jumps to an absolute timestamp instead of a relative step.
  yield* TestClock.setTime(Date.UTC(2025, 0, 1))
  const now = yield* Clock.currentTimeMillis
  yield* Console.log('now:', new Date(now).toISOString())
})

export const program = test.pipe(
  // `TestClock.layer()` provides the virtual clock. `@effect/vitest`'s
  // `it.effect` provides it for you; here we provide it by hand.
  Effect.provide(TestClock.layer()),
)
