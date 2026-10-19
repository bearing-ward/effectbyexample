/**
 * @title Back-pressure with a bounded Queue
 * @difficulty intermediate
 * @summary A `Queue` hands work from producers to consumers. A bounded
 * queue has a fixed capacity: when it is full, `offer` waits until a
 * consumer makes room. That waiting is back-pressure, and it keeps a fast
 * producer from piling up unlimited work in memory.
 */

import { Cause, Console, Effect, Fiber, Queue, Ref } from 'effect'

export const program = Effect.gen(function* () {
  // Room for two jobs. The error type `Cause.Done` lets us end the queue
  // later to say "no more jobs".
  const jobs = yield* Queue.bounded<string, Cause.Done>(2)
  const offered = yield* Ref.make(0)

  // The producer has five thumbnails to queue.
  const producer = yield* Effect.forkChild(
    Effect.forEach(['a.png', 'b.png', 'c.png', 'd.png', 'e.png'], (file) =>
      Queue.offer(jobs, file).pipe(
        Effect.andThen(Ref.update(offered, (n) => n + 1)),
      ),
    ),
  )

  // Without a consumer, the producer fills the queue and then waits on its
  // third `offer`.
  yield* Effect.yieldNow
  yield* Console.log(
    'queued:',
    yield* Queue.size(jobs),
    'offered:',
    yield* Ref.get(offered),
  )

  // Each `take` makes room, and the waiting producer adds one more.
  yield* Console.log('took', yield* Queue.take(jobs))
  yield* Effect.yieldNow
  yield* Console.log(
    'queued:',
    yield* Queue.size(jobs),
    'offered:',
    yield* Ref.get(offered),
  )

  // Once the producer is done, `Queue.end` marks the queue finished.
  // `Queue.collect` takes what is left until the end.
  const consumer = yield* Effect.forkChild(Queue.collect(jobs))
  yield* Fiber.join(producer)
  yield* Queue.end(jobs)
  yield* Console.log('rest:', yield* Fiber.join(consumer))

  // When waiting is wrong, for example for metrics samples where only
  // recent values matter, other strategies never block the producer.
  // `sliding` drops the oldest item, `dropping` refuses the newest.
  const sliding = yield* Queue.sliding<number>(2)
  yield* Queue.offerAll(sliding, [1, 2, 3, 4])
  yield* Console.log('sliding keeps:', yield* Queue.takeAll(sliding))

  const dropping = yield* Queue.dropping<number>(2)
  yield* Queue.offerAll(dropping, [1, 2, 3, 4])
  yield* Console.log('dropping keeps:', yield* Queue.takeAll(dropping))
})
