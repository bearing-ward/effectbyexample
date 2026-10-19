/**
 * @title Persisted messages
 * @difficulty intermediate
 * @summary By default an entity message only travels over the network, and is
 * lost if a machine dies. Mark an RPC as persisted and the cluster writes the
 * message and its reply to `MessageStorage`, so it survives restarts and a
 * repeated request returns the stored reply instead of running twice.
 */

import {
  Console,
  Effect,
  Layer,
  PrimaryKey,
  Ref,
  Schedule,
  Schema,
} from 'effect'
import {
  ClusterSchema,
  Entity,
  MessageStorage,
  TestRunner,
} from 'effect/cluster'
import { Rpc } from 'effect/rpc'

// A payload class can name its own primary key. Two messages to the same
// entity and RPC with the same key count as one message.
class ChargePayload extends Schema.Class<ChargePayload>('ChargePayload')({
  paymentId: Schema.String,
  cents: Schema.Number,
}) {
  [PrimaryKey.symbol]() {
    return this.paymentId
  }
}

// `ClusterSchema.Persisted` is an annotation on the RPC. `Balance` is left
// volatile: it is a read, and losing one costs nothing.
const Charge = Rpc.make('Charge', {
  payload: ChargePayload,
  success: Schema.String,
}).annotate(ClusterSchema.Persisted, true)
const Balance = Rpc.make('Balance', { success: Schema.Number })

const Account = Entity.make('Account', [Charge, Balance])

export const program = Effect.gen(function* () {
  const chargesRun = yield* Ref.make(0)

  const AccountLive = Account.toLayer(
    Effect.gen(function* () {
      const balance = yield* Ref.make(0)
      return Account.of({
        Charge: ({ payload }) =>
          Effect.gen(function* () {
            yield* Ref.update(chargesRun, (count) => count + 1)
            yield* Ref.update(balance, (cents) => cents + payload.cents)
            return `charged ${payload.cents} cents for ${payload.paymentId}`
          }),
        Balance: () => Ref.get(balance),
      })
    }),
  )

  yield* Effect.gen(function* () {
    const account = (yield* Account.client)('acct-1')

    // Suppose the caller timed out and sent `p-1` again. The second call
    // finds the stored reply and returns it without charging twice.
    yield* Console.log(
      yield* account.Charge(
        new ChargePayload({ paymentId: 'p-1', cents: 500 }),
      ),
    )
    yield* Console.log(
      yield* account.Charge(
        new ChargePayload({ paymentId: 'p-1', cents: 500 }),
      ),
    )
    yield* Console.log(`balance: ${yield* account.Balance()}`)
    yield* Console.log(`charges run: ${yield* Ref.get(chargesRun)}`)

    // `discard: true` returns as soon as the message is stored. Delivery
    // happens afterwards, which is safe because the message is already in
    // storage.
    yield* account.Charge(new ChargePayload({ paymentId: 'p-2', cents: 300 }), {
      discard: true,
    })

    // The test runner keeps storage in memory, and `MemoryDriver` lets us
    // look inside. We wait until both charges have a stored reply.
    const storage = yield* MessageStorage.MemoryDriver
    const entries = Effect.sync(() => [...storage.requests.values()])
    yield* entries.pipe(
      Effect.repeat({
        until: (all) =>
          all.length === 2 && all.every((entry) => entry.replies.length > 0),
        schedule: Schedule.spaced('1 millis'),
      }),
    )

    // Only the persisted messages were written, each with its reply. The
    // `Balance` read is not there.
    for (const entry of yield* entries) {
      if (entry.envelope._tag !== 'Request') continue
      const [reply] = entry.replies
      const outcome =
        reply?._tag === 'WithExit' && reply.exit._tag === 'Success'
          ? reply.exit.value
          : 'failed'
      yield* Console.log(`stored ${entry.envelope.tag}: ${outcome}`)
    }
    yield* Console.log(`charges run: ${yield* Ref.get(chargesRun)}`)
  }).pipe(
    Effect.provide(AccountLive.pipe(Layer.provideMerge(TestRunner.layer))),
  )
})
