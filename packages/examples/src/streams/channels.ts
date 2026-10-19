/**
 * @title Channels: the primitive under streams
 * @difficulty advanced
 * @summary Every `Stream` and `Sink` is built on a `Channel`. A channel reads
 * input, writes output, and finishes with a final "done" value. You rarely
 * need channels in application code, but they explain how streams work and
 * let you write reusable stream transformers.
 */

import { Array, Channel, Console, Effect, Stream } from 'effect'

// A `Channel` has seven type parameters, in two groups. The output side
// says what it emits (`OutElem`), how it fails (`OutErr`), and what it
// returns when it finishes (`OutDone`). The input side says what it reads
// from upstream (`InElem`, `InErr`, `InDone`). The last is the services it
// needs (`Env`).
//
// A channel with no input is a producer. This one emits from a generator,
// and the generator's `return` value becomes the channel's done value.
function* importBatch() {
  yield 'ada'
  yield 'grace'
  return { imported: 2 }
}
const producer = Channel.fromIterable(importBatch())

export const program = Effect.gen(function* () {
  // `runCollect` keeps the emitted elements. `runDrain` ignores them and
  // returns the done value instead. A stream has no done value, which is
  // one of the details it hides.
  yield* Console.log(yield* Channel.runCollect(producer))
  yield* Console.log(
    yield* Channel.runDrain(Channel.fromIterable(importBatch())),
  )

  // A `Stream<A>` is a channel that emits non-empty arrays of `A`. Arrays,
  // not single values, so a stream can move values in batches. Looking at
  // the channel shows the batches that `Stream.runCollect` flattens away.
  const stream = Stream.concat(Stream.make('ada', 'grace'), Stream.make('alan'))
  yield* Console.log(yield* Channel.runCollect(Stream.toChannel(stream)))

  // A channel that reads input is a transformer. `Channel.splitLines` reads
  // batches of text and writes batches of lines, and `filterArray` then drops
  // blank ones. The result is a plain value, so any stream of text can reuse
  // it through `Stream.pipeThroughChannel`.
  const nonEmptyLines = Channel.splitLines<never, unknown>().pipe(
    Channel.filterArray((line) => line.trim() !== ''),
  )

  // Text often arrives in arbitrary chunks, as from a socket or file. The
  // line breaks do not line up with the chunks, and the channel keeps the
  // partial line until the rest of it arrives.
  const chunks = Stream.make('order,ada\nord', 'er,grace\n\norder,', 'alan\n')
  const lines = yield* chunks.pipe(
    Stream.pipeThroughChannel(nonEmptyLines),
    Stream.runCollect,
  )
  yield* Console.log(lines)

  // `Stream.fromChannel` turns a channel back into a stream. `Channel.map`
  // works on whole batches, so we map each batch with `Array.map`.
  const shouting = Stream.fromChannel(
    Stream.toChannel(stream).pipe(
      Channel.map((batch) => Array.map(batch, (name) => name.toUpperCase())),
    ),
  )
  yield* Console.log(yield* Stream.runCollect(shouting))
})
