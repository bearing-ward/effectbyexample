/**
 * @title Sorting and comparing with Order and Equivalence
 * @difficulty intermediate
 * @summary An `Order` says how to sort a type, and an `Equivalence` says when
 * two values count as the same. Both are small values you build once from
 * simple pieces and reuse, instead of writing comparator callbacks by hand.
 */

import { Array, Console, Effect, Equivalence, Order, Ordering } from 'effect'

interface Product {
  readonly name: string
  readonly category: string
  readonly cents: number
}

const lamp: Product = { name: 'Lamp', category: 'home', cents: 3500 }
const mug: Product = { name: 'mug', category: 'kitchen', cents: 1200 }
const kettle: Product = { name: 'Kettle', category: 'kitchen', cents: 4500 }
const rug: Product = { name: 'Rug', category: 'home', cents: 3500 }
const products = [lamp, mug, kettle, rug]

// An `Order<A>` is a function `(a, b) => -1 | 0 | 1`. That result type is an
// `Ordering`. `mapInput` adapts an order for a field to the whole product.
const byPrice = Order.mapInput(Order.Number, (p: Product) => p.cents)
const byCategory = Order.mapInput(Order.String, (p: Product) => p.category)

// `Order.combine` uses the second order only to break ties in the first.
// `Order.flip` reverses an order.
const byCategoryThenPriciest = Order.combine(byCategory, Order.flip(byPrice))

const names = (list: ReadonlyArray<Product>) =>
  list.map((p) => p.name).join(', ')

export const program = Effect.gen(function* () {
  yield* Console.log('by price:', names(Array.sort(products, byPrice)))
  yield* Console.log(
    'by category, priciest first:',
    names(Array.sort(products, byCategoryThenPriciest)),
  )

  // Orders also answer questions directly, like "which is smaller?".
  yield* Console.log(
    'cheaper of lamp and mug:',
    Order.min(byPrice)(lamp, mug).name,
  )

  // `Ordering` is the -1, 0, 1 result itself. `Ordering.match` names the
  // three outcomes, and `Ordering.reverse` flips one.
  const comparePrices = Ordering.match({
    onLessThan: () => 'cheaper',
    onEqual: () => 'same price',
    onGreaterThan: () => 'pricier',
  })
  yield* Console.log('lamp vs rug:', comparePrices(byPrice(lamp, rug)))
  yield* Console.log('kettle vs mug:', comparePrices(byPrice(kettle, mug)))
  yield* Console.log(
    'reversed:',
    comparePrices(Ordering.reverse(byPrice(kettle, mug))),
  )

  // `Ordering.Reducer` combines several comparison results: the first one
  // that is not 0 wins, the same rule `Order.combine` uses for ties.
  yield* Console.log('decisive:', Ordering.Reducer.combineAll([0, 0, -1, 1]))

  // An `Equivalence` decides sameness. Here, names that differ only in case
  // are the same product, so the imported `MUG` is dropped.
  const sameName = Equivalence.mapInput(Equivalence.String, (p: Product) =>
    p.name.toLowerCase(),
  )
  const imported = [
    ...products,
    { name: 'MUG', category: 'kitchen', cents: 1100 },
  ]
  yield* Console.log('deduped:', names(Array.dedupeWith(imported, sameName)))

  // `Equivalence.Struct` compares several fields, each with its own rule.
  const sameListing = Equivalence.Struct({
    category: Equivalence.String,
    cents: Equivalence.Number,
  })
  yield* Console.log('lamp and rug same listing:', sameListing(lamp, rug))
})
