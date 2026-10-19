/**
 * @title One message at a time
 * @difficulty intermediate
 * @summary An entity handles its messages one after another, so its handlers
 * never race on its state. Messages that arrive meanwhile wait in a mailbox,
 * and when the mailbox is full the caller gets a `MailboxFull` error.
 */

import { Console, Deferred, Effect, Fiber, Layer, Schema } from 'effect'
import { ClusterError, Entity, TestRunner } from 'effect/cluster'
import { Rpc } from 'effect/rpc'

const Deposit = Rpc.make('Deposit', {
  payload: { cents: Schema.Number },
  success: Schema.Number,
})
const Wallet = Entity.make('Wallet', [Deposit])

export const program = Effect.gen(function* () {
  // The first deposit blocks until we open this gate, so we can see what
  // happens to the messages behind it.
  const gate = yield* Deferred.make<void>()

  const WalletLive = Wallet.toLayer(
    Effect.sync(() => {
      // A plain variable is safe here. Only one handler runs at a time for a
      // given wallet, so there is no read-modify-write race. The
      // `concurrency` option of `toLayer`, or `Rpc.fork` on a handler, opts
      // out of this.
      let balance = 0
      return Wallet.of({
        Deposit: ({ payload }) =>
          Effect.gen(function* () {
            yield* Console.log(`start deposit of ${payload.cents}`)
            yield* Deferred.await(gate)
            balance += payload.cents
            yield* Console.log(`finish deposit of ${payload.cents}`)
            return balance
          }),
      })
    }),
    // The mailbox holds the message being handled plus those waiting. A
    // small capacity makes the limit easy to hit. The default is 4096.
    { mailboxCapacity: 2 },
  )

  yield* Effect.gen(function* () {
    const wallet = (yield* Wallet.client)('wallet-1')

    // Four deposits arrive at once. `MailboxFull` is one of the errors in
    // `ClusterError`, and every entity client can fail with it.
    const deposits = yield* Effect.forEach(
      [100, 200, 300, 400],
      (cents) =>
        wallet.Deposit({ cents }).pipe(
          Effect.map((balance) => `${cents}: balance ${balance}`),
          Effect.catchTag('MailboxFull', (error: ClusterError.MailboxFull) =>
            Effect.succeed(
              `${cents}: rejected, ${error._tag} for ${error.address.entityId}`,
            ),
          ),
        ),
      { concurrency: 'unbounded' },
    ).pipe(Effect.forkChild)

    // Let the first deposit start and the others queue up, then release it.
    // The second deposit only starts after the first has finished.
    yield* Effect.sleep('20 millis')
    yield* Deferred.succeed(gate, undefined)

    for (const line of yield* Fiber.join(deposits)) {
      yield* Console.log(line)
    }
  }).pipe(Effect.provide(WalletLive.pipe(Layer.provideMerge(TestRunner.layer))))
})
