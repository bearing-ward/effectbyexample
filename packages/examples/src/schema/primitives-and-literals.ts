/**
 * @title Primitives, literals, and unions
 * @difficulty beginner
 * @summary The building blocks: primitive schemas for strings, numbers, and
 * booleans, literal schemas for exact values, and unions for "one of these".
 */

import { Console, Effect, Schema } from 'effect'

// Primitive schemas mirror TypeScript's primitive types.
const Title = Schema.String
const Price = Schema.Number
const InStock = Schema.Boolean

// `Schema.Literal` accepts exactly one value. `Schema.Literals` accepts any
// value from a list, which is how you model an enum.
const Currency = Schema.Literal('USD')
const Size = Schema.Literals(['small', 'medium', 'large'])

// `Schema.Union` accepts a value that matches any of its members. Here an id
// may be a number or a string.
const ProductId = Schema.Union([Schema.Number, Schema.String])

// Combine them in a struct. The derived type is
// `{ size: "small" | "medium" | "large"; id: string | number; ... }`.
const Product = Schema.Struct({
  id: ProductId,
  title: Title,
  price: Price,
  currency: Currency,
  size: Size,
  inStock: InStock,
})

export const program = Effect.gen(function* () {
  const shirt = Schema.decodeUnknownSync(Product)({
    id: 'sku-42',
    title: 'Effect T-shirt',
    price: 25,
    currency: 'USD',
    size: 'medium',
    inStock: true,
  })
  yield* Console.log(shirt)

  // Literals reject anything outside their list.
  yield* Console.log(Schema.is(Size)('medium'))
  yield* Console.log(Schema.is(Size)('extra-large'))

  // Every literal schema keeps its list, which is handy for building menus.
  yield* Console.log(Size.literals)
})
