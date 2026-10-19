/**
 * @title Validating events
 * @difficulty intermediate
 * @summary A handler can reject an event. If it fails, the event is not
 * committed, so the log only ever contains events that were valid when
 * written. A handler can also return a value to the writer.
 */

import { Console, Effect, Layer, Ref, Schema } from 'effect'
import {
  EventGroup,
  EventJournal,
  EventLog,
  EventLogEncryption,
} from 'effect/eventlog'

class InsufficientFunds extends Schema.TaggedError<InsufficientFunds>()(
  'InsufficientFunds',
  { balance: Schema.Number },
) {}

const Movement = Schema.Struct({
  accountId: Schema.String,
  cents: Schema.Number,
})

// `success` and `error` schemas describe what the handler returns. Here both
// events return the new balance, and a withdrawal can fail.
const AccountEvents = EventGroup.empty
  .add({
    tag: 'Deposited',
    primaryKey: (movement) => movement.accountId,
    payload: Movement,
    success: Schema.Number,
  })
  .add({
    tag: 'Withdrew',
    primaryKey: (movement) => movement.accountId,
    payload: Movement,
    success: Schema.Number,
    error: InsufficientFunds,
  })

const AccountLog = EventLog.schema(AccountEvents)

export const program = Effect.gen(function* () {
  const balance = yield* Ref.make(0)

  const AccountHandlers = EventLog.group(AccountEvents, (handlers) =>
    handlers
      .handle('Deposited', ({ payload }) =>
        Ref.updateAndGet(balance, (cents) => cents + payload.cents),
      )
      .handle('Withdrew', ({ payload }) =>
        Effect.gen(function* () {
          const current = yield* Ref.get(balance)
          // Failing here aborts the write: nothing reaches the journal.
          if (current < payload.cents) {
            return yield* new InsufficientFunds({ balance: current })
          }
          return yield* Ref.updateAndGet(
            balance,
            (cents) => cents - payload.cents,
          )
        }),
      ),
  )

  const AccountLogLive = EventLog.layer(AccountLog, AccountHandlers).pipe(
    Layer.provide(EventLog.layerRegistry),
    Layer.provide(EventJournal.layerMemory),
    Layer.provide(
      Layer.effect(EventLog.Identity, EventLog.makeIdentity).pipe(
        Layer.provide(EventLogEncryption.layerSubtle),
      ),
    ),
  )

  yield* Effect.gen(function* () {
    const write = yield* EventLog.makeClient(AccountLog)
    const account = { accountId: 'acc-1' }

    // The handler's return value is the result of the write.
    yield* Console.log(
      `balance: ${yield* write('Deposited', { ...account, cents: 1000 })}`,
    )
    yield* Console.log(
      `balance: ${yield* write('Withdrew', { ...account, cents: 300 })}`,
    )

    // The handler's typed error is the write's typed error.
    const overdraw = yield* write('Withdrew', { ...account, cents: 5000 }).pipe(
      Effect.map((cents) => `balance: ${cents}`),
      Effect.catchTag('InsufficientFunds', (error) =>
        Effect.succeed(`rejected, balance is ${error.balance}`),
      ),
    )
    yield* Console.log(overdraw)

    // Three writes, two entries: the rejected withdrawal was never recorded.
    const log = yield* EventLog.EventLog
    yield* Console.log(`entries: ${(yield* log.entries).length}`)
  }).pipe(Effect.provide(AccountLogLive))
})
