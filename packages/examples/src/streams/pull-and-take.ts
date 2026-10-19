/**
 * @title Pulling by hand with Pull and Take
 * @difficulty advanced
 * @summary Under every `run*` call, something repeatedly pulls the next
 * batch from a stream. `Stream.toPull` hands you that pull effect, and the
 * `Pull` module tells "the stream ended" apart from a real failure. `Take`
 * stores one pull result as data, so it can travel through a queue or PubSub.
 */

import { Console, Effect, Exit, PubSub, Pull, Stream, Take } from 'effect'

const tickets = Stream.make('T-1', 'T-2').pipe(
  Stream.concat(Stream.make('T-3')),
)

export const program = Effect.gen(function* () {
  // `toPull` needs a `Scope`, because the stream may hold resources until
  // we stop pulling. Each `yield* pull` returns the next non-empty batch.
  yield* Effect.scoped(
    Effect.gen(function* () {
      const pull = yield* Stream.toPull(tickets)
      yield* Console.log(yield* pull)
      yield* Console.log(yield* pull)

      // A `Pull<A, E, Done>` is an `Effect` whose error channel also carries
      // a `Cause.Done` signal for the end of the stream. `Pull.matchEffect`
      // splits the three outcomes: a value, a failure, or done.
      const describe = Pull.matchEffect(pull, {
        onSuccess: (batch) => Effect.succeed(`batch ${batch.join(', ')}`),
        onFailure: (cause) => Effect.succeed(`failed: ${cause}`),
        onDone: () => Effect.succeed('stream ended'),
      })
      // The stream had two batches, so the third pull reports done.
      yield* Console.log(yield* describe)
    }),
  )

  // A `Take<A, E>` is one pull result as plain data: a non-empty array of
  // values, or an `Exit` that ends the stream. `toPubSubTake` publishes a
  // stream as takes, so late subscribers also learn how it ended.
  yield* Effect.scoped(
    Effect.gen(function* () {
      const pubsub = yield* tickets.pipe(
        Stream.toPubSubTake({ capacity: 'unbounded', replay: 3 }),
      )
      const subscription = yield* PubSub.subscribe(pubsub)
      for (let i = 0; i < 3; i++) {
        const take = yield* PubSub.take(subscription)
        yield* Console.log(
          Exit.isExit(take)
            ? `exit: ${take._tag}`
            : `values: ${take.join(', ')}`,
        )
      }

      // `Stream.fromPubSubTake` turns the takes back into a stream: the
      // arrays become values and the `Exit` ends it. It subscribes after the
      // stream has already finished, and still sees everything because
      // `replay: 3` keeps the last three takes for late subscribers.
      // Without replay it would see only the end, and collect nothing.
      yield* Console.log(
        yield* Stream.runCollect(Stream.fromPubSubTake(pubsub)),
      )
    }),
  )

  // `Take.toPull` interprets a single take as a pull step. A failure exit
  // becomes an ordinary failure, which `Pull.catchDone` leaves alone; an
  // end-of-stream exit becomes done, which `catchDone` handles.
  const ended = Take.toPull(Exit.void).pipe(
    Pull.catchDone(() => Effect.succeed('done, nothing more to read')),
  )
  yield* Console.log(yield* ended)
  const failed = Take.toPull(Exit.fail('printer jammed')).pipe(
    Pull.catchDone(() => Effect.succeed('done')),
    Effect.catch((error) => Effect.succeed(`failure: ${error}`)),
  )
  yield* Console.log(yield* failed)
})
