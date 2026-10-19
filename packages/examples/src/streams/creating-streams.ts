/**
 * @title Creating streams
 * @difficulty beginner
 * @summary Streams come from many sources: in-memory collections, paginated
 * APIs, effects repeated on a schedule, and callback-based APIs. Each
 * constructor turns its source into the same `Stream` type, so the rest of
 * your pipeline does not care where the values came from.
 */

import {
  Clock,
  Console,
  Effect,
  Fiber,
  Option,
  Queue,
  Schedule,
  Stream,
} from 'effect'
import { TestClock } from 'effect/testing'

// `fromIterable` wraps any iterable: arrays, sets, generators.
const cartItems = Stream.fromIterable(['keyboard', 'mouse', 'monitor'])

// `paginate` reads a cursor-based API. The function receives the cursor and
// returns this page's values plus the next cursor. `Option.none()` ends the
// stream. Pages are fetched only when the consumer needs more values.
const pages: ReadonlyArray<ReadonlyArray<string>> = [
  ['ada', 'grace'],
  ['alan', 'barbara'],
  ['edsger'],
]
const fetchPage = (page: number) =>
  Console.log(`  GET /users?page=${page}`).pipe(
    Effect.as([
      pages[page] ?? [],
      page + 1 < pages.length ? Option.some(page + 1) : Option.none(),
    ] as const),
  )
const users = Stream.paginate(0, fetchPage)

// `fromEffectSchedule` runs an effect once, then again each time the
// schedule allows. It is a good fit for polling. The effect here reads the
// clock, so the output shows when each poll happened.
const healthChecks = Stream.fromEffectSchedule(
  Clock.currentTimeMillis.pipe(Effect.map((ms) => `health check at ${ms}ms`)),
  Schedule.spaced('30 seconds'),
).pipe(Stream.take(3))

// `callback` adapts push-based APIs such as event emitters or WebSockets.
// You receive a queue: offer values into it and end it when the source
// finishes. Here a fake emitter pushes three events.
const clicks = Stream.callback<string>((queue) =>
  Effect.sync(() => {
    for (const button of ['save', 'preview', 'publish']) {
      Queue.offerUnsafe(queue, `clicked ${button}`)
    }
    Queue.endUnsafe(queue)
  }),
)

export const program = Effect.gen(function* () {
  yield* Console.log(yield* Stream.runCollect(cartItems))

  // Taking three users needs only the first two pages, so page 2 is never
  // requested.
  yield* Console.log('first three users:')
  yield* Console.log(yield* Stream.runCollect(Stream.take(users, 3)))

  // Waiting 30 real seconds between polls would make this example slow, so
  // we run it on a `TestClock`. The stream runs in a background fiber, and
  // moving the clock forward by a minute lets both scheduled polls happen
  // at once.
  const checks = yield* Effect.gen(function* () {
    const fiber = yield* Effect.forkChild(Stream.runCollect(healthChecks))
    yield* TestClock.adjust('1 minute')
    return yield* Fiber.join(fiber)
  }).pipe(Effect.provide(TestClock.layer()))
  yield* Console.log(checks)

  yield* Console.log(yield* Stream.runCollect(clicks))
})
