/**
 * @title Optics for nested updates
 * @difficulty advanced
 * @summary Updating one field deep inside immutable data means copying every
 * level by hand. An optic names a path into the data once, then reads,
 * replaces, or modifies what it points at, and returns a new value.
 */

import { Console, Effect, Optic, Result, Schema, SchemaIssue } from 'effect'

const Order = Schema.Struct({
  customer: Schema.Struct({
    name: Schema.String,
    address: Schema.Struct({ city: Schema.String }),
  }),
  lines: Schema.Array(Schema.Struct({ sku: Schema.String, qty: Schema.Int })),
  payment: Schema.TaggedUnion({
    Card: { last4: Schema.String },
    Invoice: { dueDays: Schema.Int },
  }),
})
type Order = typeof Order.Type

const order: Order = {
  customer: { name: 'Ada', address: { city: 'London' } },
  lines: [
    { sku: 'MUG', qty: 1 },
    { sku: 'TEE', qty: 0 },
  ],
  payment: { _tag: 'Card', last4: '4242' },
}

// Start from `Optic.id<Order>()` and add a step per level. `key` always
// finds its target, so this is a `Lens` with a plain `get`.
const city = Optic.id<Order>().key('customer').key('address').key('city')

// `tag` narrows a tagged union. The target may be missing, so `getResult`
// returns a `Result` whose failure is a `SchemaIssue`.
const cardDigits = Optic.id<Order>().key('payment').tag('Card').key('last4')

// `forEach` focuses every element of an array; `check` keeps only those that
// pass a schema check. Here: the quantity of every line with qty > 0.
const orderedQuantities = Optic.id<Order>()
  .key('lines')
  .forEach((line) => line.key('qty').check(Schema.isGreaterThan(0)))

export const program = Effect.gen(function* () {
  yield* Console.log(city.get(order))

  // `replace` copies only the objects along the path, shares the rest, and
  // leaves the original order unchanged.
  const moved = city.replace('Paris', order)
  yield* Console.log(moved.customer, order.customer.address.city)
  yield* Console.log(moved.lines === order.lines)

  yield* Console.log(cardDigits.getResult(order))
  const invoiced: Order = {
    ...order,
    payment: { _tag: 'Invoice', dueDays: 30 },
  }
  const missing = cardDigits.getResult(invoiced)
  if (Result.isFailure(missing)) {
    yield* Console.log(SchemaIssue.makeFormatterDefault()(missing.failure))
  }
  // Replacing through a path that does not match leaves the value as it was.
  yield* Console.log(cardDigits.replace('0000', invoiced) === invoiced)

  // `modifyAll` changes every focused element and skips the rest.
  yield* Console.log(Optic.getAll(orderedQuantities)(order))
  yield* Console.log(orderedQuantities.modifyAll((qty) => qty * 2)(order).lines)

  // Optics copy plain objects and throw on class instances. For a
  // `Schema.Class`, `Schema.toIso` builds the starting optic from the
  // schema, so updates give back a real instance.
  class Customer extends Schema.Class<Customer>('Customer')({
    name: Schema.String,
    tier: Schema.Literals(['basic', 'gold']),
  }) {
    get label() {
      return `${this.name} (${this.tier})`
    }
  }
  const tier = Schema.toIso(Customer).key('tier')
  const upgraded = tier.replace(
    'gold',
    new Customer({ name: 'Ada', tier: 'basic' }),
  )
  yield* Console.log(upgraded instanceof Customer, upgraded.label)
})
