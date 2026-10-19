/**
 * @title Everyday Array helpers
 * @difficulty beginner
 * @summary The `Array` module gives you data-last helpers for plain
 * JavaScript arrays, so a chain of transformations reads top to bottom
 * with `pipe`. Nothing is mutated: every step returns a new array.
 */

import { Array, Console, Effect, Order, pipe, Record, Result } from 'effect'

interface Purchase {
  readonly id: string
  readonly customer: string
  readonly cents: number
  readonly status: 'paid' | 'refunded'
}

const orders: ReadonlyArray<Purchase> = [
  { id: 'o-1', customer: 'ada', cents: 4200, status: 'paid' },
  { id: 'o-2', customer: 'grace', cents: 1500, status: 'refunded' },
  { id: 'o-3', customer: 'ada', cents: 900, status: 'paid' },
  { id: 'o-4', customer: 'alan', cents: 9900, status: 'paid' },
  { id: 'o-5', customer: 'grace', cents: 3100, status: 'paid' },
]

// An `Order` describes how to compare two values.
// `mapInput` turns an order on numbers into an order on purchases, and `flip`
// reverses it, so the biggest purchase comes first.
const byCentsDescending = Order.flip(
  Order.mapInput(Order.Number, (order: Purchase) => order.cents),
)

export const program = Effect.gen(function* () {
  // `pipe` passes the value through each step. Every helper here takes the
  // array last, so it can be used without an extra arrow function.
  const largestPaid = pipe(
    orders,
    Array.filter((order) => order.status === 'paid'),
    Array.sort(byCentsDescending),
    Array.map((order) => `${order.id} ${order.cents}`),
  )
  yield* Console.log(largestPaid)

  // `groupBy` returns a record of non-empty arrays, keyed by whatever the
  // function returns. `Record.map` then transforms each group.
  const byCustomer = Array.groupBy(orders, (order) => order.customer)
  yield* Console.log(
    Record.map(byCustomer, (group) => group.map((order) => order.id)),
  )

  // `partition` splits in one pass. The function returns a `Result`:
  // `Result.succeed` goes left, `Result.fail` goes right, and each side can
  // carry a different type.
  const [paid, refunded] = Array.partition(orders, (order) =>
    order.status === 'paid'
      ? Result.succeed(order.cents)
      : Result.fail(order.id),
  )
  yield* Console.log({ paid, refunded })

  // `dedupe` keeps the first occurrence of each value, compared with
  // `Equal.equals`. For plain strings that is ordinary equality.
  const customers = pipe(
    orders,
    Array.map((order) => order.customer),
    Array.dedupe,
  )
  yield* Console.log(customers)

  // Helpers compose with each other. Here we total paid cents per customer.
  const totals = pipe(
    orders,
    Array.filter((order) => order.status === 'paid'),
    Array.groupBy((order) => order.customer),
    Record.map((group) =>
      Array.reduce(group, 0, (sum, order) => sum + order.cents),
    ),
  )
  yield* Console.log(totals)
})
