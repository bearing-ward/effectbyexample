/**
 * @title A bank transfer
 * @difficulty beginner
 * @summary Moving money means two writes: take it from one account and add it
 * to another. `TxRef` and `Effect.tx` make those writes commit together, or
 * not at all, even when many transfers run at once.
 */

import { Console, Effect, Schema, TxRef } from 'effect'

class InsufficientFunds extends Schema.TaggedError<InsufficientFunds>()(
  'InsufficientFunds',
  { account: Schema.String, balance: Schema.Number, amount: Schema.Number },
) {}

interface Account {
  readonly name: string
  // A `TxRef` is a mutable cell that transactions can read and write.
  readonly balance: TxRef.TxRef<number>
}

// `Effect.tx` marks a transaction boundary. Inside it, every `TxRef` read and
// write goes to a private journal. The journal is committed only when the
// whole body succeeds. If the body fails, the journal is thrown away.
const transfer = (from: Account, to: Account, amount: number) =>
  Effect.tx(
    Effect.gen(function* () {
      // We credit first on purpose, so a failure below leaves a half-done
      // transfer in the journal. The transaction will discard it.
      yield* TxRef.update(to.balance, (balance) => balance + amount)

      const balance = yield* TxRef.get(from.balance)
      // Yielding lets other fibers run in the middle of our transaction, the
      // way a real program would while waiting on I/O.
      yield* Effect.yieldNow
      if (balance < amount) {
        return yield* new InsufficientFunds({
          account: from.name,
          balance,
          amount,
        })
      }
      yield* TxRef.set(from.balance, balance - amount)
    }),
  )

export const program = Effect.gen(function* () {
  const alice: Account = { name: 'alice', balance: yield* TxRef.make(100) }
  const bob: Account = { name: 'bob', balance: yield* TxRef.make(50) }

  // Outside a transaction, each `TxRef` operation is its own tiny
  // transaction, so a plain `TxRef.get` reads the committed value.
  const show = Effect.gen(function* () {
    const a = yield* TxRef.get(alice.balance)
    const b = yield* TxRef.get(bob.balance)
    yield* Console.log(`alice=${a} bob=${b} total=${a + b}`)
  })

  yield* transfer(alice, bob, 30)
  yield* show

  // Bob only has 80, so this fails. The credit to alice never commits.
  const failure = yield* transfer(bob, alice, 500).pipe(Effect.flip)
  yield* Console.log(
    `${failure._tag}: ${failure.account} has ${failure.balance}`,
  )
  yield* show

  // Now forty small transfers race in both directions. When a transaction
  // reads a `TxRef` that another one commits to first, it detects the
  // conflict and runs again with fresh values. No money is lost or created.
  yield* Effect.forEach(
    Array.from({ length: 20 }, () => [
      transfer(alice, bob, 2),
      transfer(bob, alice, 1),
    ]).flat(),
    (move) => move,
    { concurrency: 'unbounded', discard: true },
  )
  yield* show
})
