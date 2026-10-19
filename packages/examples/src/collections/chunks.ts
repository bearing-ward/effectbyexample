/**
 * @title Chunks
 * @difficulty intermediate
 * @summary A `Chunk` is an immutable, ordered sequence built for cheap
 * appending and concatenation. When you grow a list step by step and keep
 * every version, a chunk shares structure between versions instead of
 * copying the whole array each time.
 */

import { Chunk, Console, Effect, Equal, pipe } from 'effect'

interface Event {
  readonly type: string
  readonly orderId: string
}

export const program = Effect.gen(function* () {
  // Start with an empty chunk and append events as they happen. Each call
  // returns a new chunk. Appending to a frozen array with spread would copy
  // every earlier element on every step; a chunk records the append and
  // reuses what it already has.
  const empty = Chunk.empty<Event>()
  const placed = Chunk.append(empty, { type: 'placed', orderId: 'o-1' })
  const paid = Chunk.append(placed, { type: 'paid', orderId: 'o-1' })
  const shipped = Chunk.append(paid, { type: 'shipped', orderId: 'o-1' })

  // Older versions are untouched, so you can keep them as snapshots, for
  // example to undo or to compare before and after.
  yield* Console.log(empty.length, placed.length, paid.length, shipped.length)

  // `appendAll` joins two chunks. Like `append`, it does not copy the
  // elements of either side, which makes it a good fit for collecting
  // results batch by batch.
  const nextBatch = Chunk.make(
    { type: 'placed', orderId: 'o-2' },
    { type: 'placed', orderId: 'o-3' },
  )
  const log = Chunk.appendAll(shipped, nextBatch)

  // The usual helpers are there, written for chunks, and they work with
  // `pipe` just like the `Array` helpers.
  const placedOrders = pipe(
    log,
    Chunk.filter((event) => event.type === 'placed'),
    Chunk.map((event) => event.orderId),
  )
  yield* Console.log(Chunk.toReadonlyArray(placedOrders))

  // Index lookups return an `Option`, because the index might be past the
  // end.
  yield* Console.log(Chunk.get(log, 2))
  yield* Console.log(Chunk.get(log, 10))

  // Chunks compare by content with `Equal.equals`, so two chunks built
  // in different ways are equal when their elements are.
  yield* Console.log(
    Equal.equals(placedOrders, Chunk.make('o-1', 'o-2', 'o-3')),
  )

  // Most Effect 4 APIs, including `Stream.runCollect`, hand you plain
  // arrays. Convert at the edges with `Chunk.fromIterable` and
  // `Chunk.toReadonlyArray` when you need one or the other.
  const fromApi = ['o-4', 'o-5']
  yield* Console.log(
    Chunk.toReadonlyArray(
      Chunk.appendAll(placedOrders, Chunk.fromIterable(fromApi)),
    ),
  )
})
