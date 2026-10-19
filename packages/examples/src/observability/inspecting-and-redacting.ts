/**
 * @title Printing values and hiding secrets
 * @difficulty intermediate
 * @summary What ends up in a log line is decided by how a value prints.
 * `Inspectable` controls the printed form of your own classes, and
 * `Redactable` lets a value hide sensitive parts, with the decision made
 * from the context of the fiber that prints it.
 */

import {
  Console,
  Context,
  Effect,
  Inspectable,
  Logger,
  Option,
  Redactable,
  Redacted,
} from 'effect'

// Effect's own data types already print readably. Their `toString` comes
// from the same `Inspectable` protocol.
const printBuiltIns = Effect.gen(function* () {
  yield* Console.log(String(Option.some(42)))
  yield* Console.log(String(Option.none()))
})

// Extend `Inspectable.Class` and implement `toJSON` to choose what a class
// shows. `toString` and Node's inspector then use that JSON form. Here a
// card shows only its last four digits.
class Card extends Inspectable.Class {
  constructor(readonly number: string) {
    super()
  }
  toJSON() {
    return { _tag: 'Card', last4: this.number.slice(-4) }
  }
}

// A reference that support staff can turn on to see customer details.
const RevealPii = Context.Reference<boolean>('shop/RevealPii', {
  defaultValue: () => false,
})

// A `Redactable` value implements one method under `symbolRedactable`. It
// receives the context of the fiber doing the printing and returns what to
// show instead of the value itself.
class Email implements Redactable.Redactable {
  constructor(readonly address: string) {}
  [Redactable.symbolRedactable](context: Context.Context<never>) {
    return Context.get(context, RevealPii)
      ? this.address
      : this.address.replace(/^[^@]+/, '***')
  }
}

// This logger renders the message with `Inspectable.toStringUnknown`, the
// same formatting Effect's JSON loggers use. Redaction happens there.
const jsonMessages = Logger.withConsoleLog(
  Logger.make(({ message }) =>
    [message]
      .flat()
      .map((part) => Inspectable.toStringUnknown(part, 0))
      .join(' '),
  ),
)

const logCustomer = Effect.log({
  email: new Email('ada@example.com'),
  card: new Card('4242424242424242'),
  // `Redacted` is the simpler tool: it always prints `<redacted>`, and
  // `Redacted.value` is the only way to read it.
  apiKey: Redacted.make('sk_live_123'),
})

export const program = Effect.gen(function* () {
  yield* printBuiltIns
  yield* Console.log(new Card('4000056655665556').toString())

  // By default the email is masked.
  yield* logCustomer

  // The same value prints in full where `RevealPii` is on, without the
  // logging code changing at all.
  yield* logCustomer.pipe(Effect.provideService(RevealPii, true))
}).pipe(Effect.provide(Logger.layer([jsonMessages])))
