/**
 * @title Data-first, data-last, and .pipe
 * @difficulty intermediate
 * @summary Most Effect functions can be called two ways: with the value first,
 * or with the value left out so they slot into `pipe`. `Function.dual` gives
 * your own helpers the same shape, and `Pipeable` gives your own types a
 * `.pipe` method.
 */

import { Console, Effect, Function, Pipeable, pipe } from 'effect'

// Effect's own APIs are dual. These two lines do the same thing.
const dataFirst = Effect.map(Effect.succeed(2), (n) => n * 10)
const dataLast = Effect.succeed(2).pipe(Effect.map((n) => n * 10))

interface Money {
  readonly cents: number
  readonly currency: string
}

// `Function.dual(arity, body)` builds both forms from one implementation. The
// arity is the number of arguments of the data-first form. Called with two
// arguments, `addTax` runs right away. Called with one, it returns a function
// waiting for the `Money`.
const addTax: {
  (rate: number): (self: Money) => Money
  (self: Money, rate: number): Money
} = Function.dual(2, (self: Money, rate: number): Money => ({
  ...self,
  cents: Math.round(self.cents * (1 + rate)),
}))

// Extending `Pipeable.Class` adds a `.pipe` method to your own class, so it
// chains the same way an Effect does.
class Cart extends Pipeable.Class {
  constructor(readonly items: ReadonlyArray<Money>) {
    super()
  }
}

const addItem = (item: Money) => (cart: Cart) => new Cart([...cart.items, item])
const subtotal = (cart: Cart): Money => ({
  cents: cart.items.reduce((sum, item) => sum + item.cents, 0),
  currency: 'EUR',
})

export const program = Effect.gen(function* () {
  yield* Console.log(yield* dataFirst, yield* dataLast)

  const book: Money = { cents: 2000, currency: 'EUR' }
  yield* Console.log(addTax(book, 0.1))
  yield* Console.log(pipe(book, addTax(0.1)))

  // The data-last form of `addTax` fits straight into a `.pipe` chain.
  const total = new Cart([])
    .pipe(addItem(book), addItem({ cents: 500, currency: 'EUR' }))
    .pipe(subtotal, addTax(0.2))
  yield* Console.log(total)
})
