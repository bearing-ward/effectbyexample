/**
 * @title Schema classes
 * @difficulty intermediate
 * @summary `Schema.Class` defines a schema and a class at the same time. You
 * get a constructor that validates, a place for methods and getters, and
 * structural equality.
 */

import { Console, Effect, Equal, Schema } from 'effect'

// Pass the class itself as the type parameter, then an identifier and the
// fields.
class Money extends Schema.Class<Money>('Money')({
  amount: Schema.Number.check(Schema.isGreaterThanOrEqualTo(0)),
  currency: Schema.Literals(['USD', 'EUR']),
}) {
  // Add behavior as ordinary methods and getters.
  get formatted() {
    return `${this.amount.toFixed(2)} ${this.currency}`
  }

  add(other: Money) {
    return new Money({
      amount: this.amount + other.amount,
      currency: this.currency,
    })
  }
}

export const program = Effect.gen(function* () {
  // `new` runs the field checks, so an invalid `Money` cannot be built.
  const price = new Money({ amount: 19.5, currency: 'USD' })
  const tax = new Money({ amount: 1.95, currency: 'USD' })
  yield* Console.log(price.add(tax).formatted)

  // The class is also a schema. Decoding untrusted data gives you a real
  // instance, methods included.
  const decoded = yield* Schema.decodeUnknownEffect(Money)({
    amount: 5,
    currency: 'EUR',
  })
  yield* Console.log(decoded instanceof Money, decoded.formatted)

  // Instances compare by value with `Equal.equals`.
  yield* Console.log(
    Equal.equals(decoded, new Money({ amount: 5, currency: 'EUR' })),
  )

  // A negative amount fails the constructor's check.
  const result = yield* Effect.try(
    () => new Money({ amount: -1, currency: 'USD' }),
  ).pipe(
    Effect.as('built'),
    Effect.catch(() => Effect.succeed('rejected a negative amount')),
  )
  yield* Console.log(result)
})
