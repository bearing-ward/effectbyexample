/**
 * @title Branded types
 * @difficulty intermediate
 * @summary A `UserId` and an `OrderId` are both strings, but mixing them up is
 * a bug. Brands make the type system tell them apart, and the schema is the
 * only way to create one.
 */

import { Console, Effect, Schema } from 'effect'

// `Schema.brand` tags the decoded type. `UserId` is now `string & Brand<"UserId">`,
// so a plain string is no longer assignable to it.
const UserId = Schema.String.check(Schema.isPattern(/^usr_/)).pipe(
  Schema.brand('UserId'),
)
type UserId = typeof UserId.Type

const OrderId = Schema.String.check(Schema.isPattern(/^ord_/)).pipe(
  Schema.brand('OrderId'),
)
type OrderId = typeof OrderId.Type

// This function can only be called with a value that went through `UserId`.
const greet = (id: UserId) => `Hello, ${id}`

export const program = Effect.gen(function* () {
  // `make` validates and brands a value you construct in code. It throws if
  // the value breaks the checks; `makeOption` returns an `Option` instead.
  const userId = UserId.make('usr_123')
  yield* Console.log(greet(userId))

  // Decoding untrusted input brands it too.
  const orderId: OrderId = yield* Schema.decodeUnknownEffect(OrderId)('ord_9')
  yield* Console.log(orderId)

  // `greet(orderId)` and `greet('usr_123')` are both compile errors. At
  // runtime the brand costs nothing: it is still a plain string.
  yield* Console.log(typeof userId)

  // The brand's checks still run, so a bad id is rejected.
  yield* Console.log(UserId.makeOption('ord_9'))
})
