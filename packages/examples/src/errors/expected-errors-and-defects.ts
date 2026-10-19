/**
 * @title Expected errors and defects
 * @difficulty beginner
 * @summary Effect splits failures in two. Expected errors are part of your
 * domain, live in the type, and are meant to be handled. Defects are bugs or
 * broken assumptions; they are not in the type and ordinary error handlers
 * let them pass.
 */

import { Console, Effect, Schema } from 'effect'

// An expected error: a customer can always try to withdraw too much.
class InsufficientFunds extends Schema.TaggedError<InsufficientFunds>()(
  'InsufficientFunds',
  { balance: Schema.Number, requested: Schema.Number },
) {}

// `Effect.fail` puts the error in the error channel. The type is
// `Effect<number, InsufficientFunds>`, so callers know to deal with it.
const withdraw = (balance: number, requested: number) =>
  requested > balance
    ? Effect.fail(new InsufficientFunds({ balance, requested }))
    : Effect.succeed(balance - requested)

// A defect: a negative amount should be impossible here, because the form
// already rejects it. `Effect.die` records it as a bug. The error type stays
// `never`.
const checkAmount = (amount: number) =>
  amount < 0
    ? Effect.die(new Error(`negative amount ${amount}`))
    : Effect.succeed(amount)

// `Effect.catch` handles every expected error, and only those.
const handled = <A>(effect: Effect.Effect<A, InsufficientFunds>) =>
  effect.pipe(
    Effect.catch((error) =>
      Effect.succeed(`declined: ${error.requested} > ${error.balance}`),
    ),
  )

export const program = Effect.gen(function* () {
  yield* Console.log(yield* handled(withdraw(100, 30)))
  yield* Console.log(yield* handled(withdraw(100, 500)))

  // A defect slips past `Effect.catch`. `catchDefect` is the escape hatch,
  // used at the edges of an app to log bugs, not to recover from them.
  const bug = yield* handled(checkAmount(-5)).pipe(
    Effect.catchDefect((defect) => Effect.succeed(`defect: ${defect}`)),
  )
  yield* Console.log(bug)

  // An exception thrown inside `Effect.sync` is a defect too: `sync` promises
  // the code does not throw.
  const thrown = yield* Effect.sync(() => {
    throw new Error('ledger corrupted')
  }).pipe(Effect.catchDefect((defect) => Effect.succeed(`defect: ${defect}`)))
  yield* Console.log(thrown)

  // `Effect.orDie` turns an expected error into a defect. Use it when, at
  // this call site, the error really cannot happen. The error type becomes
  // `never`, so there is nothing left to handle.
  const trusted: Effect.Effect<number> = withdraw(100, 500).pipe(Effect.orDie)
  const crashed = yield* trusted.pipe(
    Effect.catchDefect((defect) =>
      Effect.succeed(`defect: ${(defect as InsufficientFunds)._tag}`),
    ),
  )
  yield* Console.log(crashed)
})
