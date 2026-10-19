/**
 * @title Brands and newtypes
 * @difficulty intermediate
 * @summary An order id and a customer id are both strings, and a price in
 * cents is a plain number. Brands and newtypes give such values their own
 * types, so the compiler stops you from mixing them up. Brands can also
 * validate at runtime.
 */

import {
  Array,
  Brand,
  Console,
  Effect,
  Newtype,
  Order,
  Result,
  Schema,
} from 'effect'

// `Brand.nominal` brands without checking anything. `OrderId` is still a
// string at runtime, but a plain string is not an `OrderId` to TypeScript.
type OrderId = string & Brand.Brand<'OrderId'>
const OrderId = Brand.nominal<OrderId>()

// `Brand.make` validates. Return `true` to accept, or a message to reject.
type Cents = number & Brand.Brand<'Cents'>
const Cents = Brand.make<Cents>(
  (n) => Number.isInteger(n) || `expected whole cents, got ${n}`,
)

// `Brand.check` reuses Schema's checks, and `Brand.all` joins brands. A
// `Price` must pass both and carries both brands.
type Positive = number & Brand.Brand<'Positive'>
const Positive = Brand.check<Positive>(Schema.isGreaterThan(0))
const Price = Brand.all(Cents, Positive)
type Price = Brand.Brand.FromConstructor<typeof Price>

const describe = (id: OrderId, price: Price) => `${id} costs ${price} cents`

// A newtype is purely compile-time: no runtime checks and no runtime cost.
// `Newtype` is marked unstable in Effect 4.0.
interface Sku extends Newtype.Newtype<'Sku', string> {}
const sku = Newtype.makeIso<Sku>()

export const program = Effect.gen(function* () {
  // The constructor throws on invalid input. Use it for values you trust.
  // Calling `describe('ord-1', 1250)` would not compile: the brands are
  // missing.
  yield* Console.log(describe(OrderId('ord-1'), Price(1250)))

  // `result` and `option` validate without throwing. A failure is a
  // `BrandError` listing every check that failed.
  for (const input of [1250, 12.5, -3, -2.5]) {
    const price = Price.result(input)
    yield* Console.log(
      Result.isSuccess(price)
        ? `ok: ${price.success}`
        : `rejected ${input}: ${price.failure.message.replaceAll('\n', '; ')}`,
    )
  }
  yield* Console.log('is 0 a price?', Price.is(0))

  // A newtype is wrapped with `set` and unwrapped with `get` or
  // `Newtype.value`. Unlike a brand, the wrapped type is not a string, so it
  // cannot leak into string code by accident.
  const mug = sku.set('MUG-01')
  yield* Console.log(Newtype.value(mug), sku.get(mug).length)

  // Helpers lift instances for the carrier type, like an `Order`, to the
  // newtype.
  const bySku = Newtype.makeOrder<Sku>(Order.String)
  const sorted = Array.sort([sku.set('RUG-02'), mug, sku.set('LAMP-07')], bySku)
  yield* Console.log(sorted.map(Newtype.value))
})
