/**
 * @title Sharing with reference counting
 * @difficulty intermediate
 * @summary `RcRef` opens a resource the first time someone asks for it,
 * shares it while anyone still holds it, and closes it when the last holder
 * lets go. `RcMap` does the same for a resource per key.
 */

import { Console, Effect, RcMap, RcRef } from 'effect'

const open = (name: string) =>
  Effect.acquireRelease(Effect.as(Console.log(`open ${name}`), name), () =>
    Console.log(`close ${name}`),
  )

export const program = Effect.gen(function* () {
  // `RcRef.make` does not open anything yet. It describes how to.
  const socket = yield* RcRef.make({ acquire: open('price feed') })

  // `RcRef.get` borrows the value for the current scope. Two nested
  // borrowers share one open feed, and it closes only when the outer scope,
  // the last holder, closes.
  yield* Effect.scoped(
    Effect.gen(function* () {
      const feed = yield* RcRef.get(socket)
      yield* Console.log(`dashboard reads ${feed}`)
      yield* Effect.scoped(
        Effect.gen(function* () {
          const same = yield* RcRef.get(socket)
          yield* Console.log(`alerts read ${same}`)
        }),
      )
      yield* Console.log('alerts done, feed still open')
    }),
  )

  // The next borrower after that opens it again.
  yield* Effect.scoped(RcRef.get(socket))

  // `RcMap` keys the same idea. `lookup` opens the resource for a key.
  const rooms = yield* RcMap.make({
    lookup: (room: string) => open(`room ${room}`),
  })

  // Two users in `lobby` share it; `kitchen` gets its own.
  yield* Effect.scoped(
    Effect.gen(function* () {
      yield* RcMap.get(rooms, 'lobby')
      yield* RcMap.get(rooms, 'lobby')
      yield* RcMap.get(rooms, 'kitchen')
      yield* Console.log('open rooms:', [...(yield* RcMap.keys(rooms))])
    }),
  )
  yield* Console.log('open rooms:', [...(yield* RcMap.keys(rooms))])
}).pipe(
  // The refs themselves live in a scope. Closing it would close anything
  // still held.
  Effect.scoped,
)
