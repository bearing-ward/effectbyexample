/**
 * @title Transactional queues
 * @difficulty intermediate
 * @summary `TxQueue` and `TxPriorityQueue` are queues whose `offer` and `take`
 * join a transaction. Taking from one queue and offering to another in the
 * same transaction moves an item without ever losing it in between.
 */

import { Cause, Console, Effect, Order, TxPriorityQueue, TxQueue } from 'effect'

interface Ticket {
  readonly id: string
  readonly severity: number
}

export const program = Effect.gen(function* () {
  // A priority queue hands out the smallest element first, according to the
  // `Order` you give it. Severity 1 is the most urgent.
  const incoming = yield* TxPriorityQueue.empty<Ticket>(
    Order.mapInput(Order.Number, (ticket: Ticket) => ticket.severity),
  )

  // A `TxQueue` is first in, first out. Declaring `Cause.Done` in the error
  // type lets the producer end the queue so the consumer knows to stop.
  const assigned = yield* TxQueue.unbounded<string, Cause.Done>()

  // The dispatcher moves a ticket from `incoming` to `assigned` in one
  // transaction. `TxPriorityQueue.take` retries while the queue is empty, so
  // the dispatcher waits without polling.
  const dispatch = Effect.tx(
    Effect.gen(function* () {
      const ticket = yield* TxPriorityQueue.take(incoming)
      yield* TxQueue.offer(assigned, `${ticket.id} (sev ${ticket.severity})`)
    }),
  )

  // Start the dispatcher before any tickets exist. After three tickets it
  // ends the `assigned` queue.
  yield* Effect.forkChild(
    dispatch.pipe(
      Effect.repeat({ times: 2 }),
      Effect.andThen(TxQueue.end(assigned)),
    ),
  )

  // Three tickets arrive in one transaction. The dispatcher sees all of them
  // at once, never a partial batch, so it starts with the most urgent.
  yield* Effect.tx(
    Effect.forEach(
      [
        { id: 'T-1', severity: 3 },
        { id: 'T-2', severity: 1 },
        { id: 'T-3', severity: 2 },
      ],
      (ticket) => TxPriorityQueue.offer(incoming, ticket),
    ),
  )

  // The consumer takes forever, until the queue is done. After `end`, and
  // once the queue is empty, `take` fails with `Cause.Done`, which we catch
  // to stop the loop.
  yield* TxQueue.take(assigned).pipe(
    Effect.flatMap((ticket) => Console.log(`assigned ${ticket}`)),
    Effect.forever,
    Effect.catchIf(Cause.isDone, () => Effect.void),
  )
  yield* Console.log(`incoming left: ${yield* TxPriorityQueue.size(incoming)}`)
})
