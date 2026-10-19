/**
 * @title Your own variants with VariantSchema
 * @difficulty advanced
 * @summary `Model` is one preset of a more general tool. `VariantSchema.make`
 * lets you name your own variants, here the internal, partner, and public
 * views of a product catalog, and derive a schema for each from one
 * declaration.
 */

import { Console, Effect, Schema } from 'effect'
import { VariantSchema } from 'effect/schema'

// `make` fixes the variant names and the default variant, and returns
// helpers bound to them. The module is marked unstable.
const { Class, Field, FieldExcept, FieldOnly, Struct, extract } =
  VariantSchema.make({
    variants: ['internal', 'partner', 'public'],
    defaultVariant: 'internal',
  })

class Product extends Class<Product>('Product')({
  // A plain schema is shared by every variant.
  sku: Schema.String,
  priceCents: Schema.Int,
  // `FieldOnly` keeps a field in the listed variants...
  costCents: FieldOnly(['internal'])(Schema.Int),
  // ...and `FieldExcept` in every variant but the listed ones.
  wholesaleCents: FieldExcept(['public'])(Schema.Int),
  // `Field` gives each variant its own schema. Staff see the exact count,
  // partners a coarse level, and the public nothing.
  stock: Field({
    internal: Schema.Int,
    partner: Schema.Literals(['in stock', 'low', 'sold out']),
  }),
}) {}

const level = (count: number) =>
  count === 0 ? 'sold out' : count < 5 ? 'low' : 'in stock'

export const program = Effect.gen(function* () {
  // The class is the default variant; the others are static properties.
  for (const [name, schema] of Object.entries({
    internal: Product,
    partner: Product.partner,
    public: Product.public,
  })) {
    yield* Console.log(name.padEnd(8), Object.keys(schema.fields).join(', '))
  }

  const mug = new Product({
    sku: 'MUG',
    priceCents: 1200,
    costCents: 300,
    wholesaleCents: 700,
    stock: 3,
  })

  // Encoding with a narrower variant drops the fields it does not have, so
  // the cost never leaks into a partner feed or the storefront.
  yield* Console.log(Schema.encodeSync(Product.public)(mug))
  yield* Console.log(
    Schema.encodeSync(Product.partner)({ ...mug, stock: level(mug.stock) }),
  )

  // `Struct` works the same without a class, and `extract` pulls out one
  // variant as a plain `Schema.Struct`.
  const PriceChange = Struct({
    sku: Schema.String,
    priceCents: Schema.Int,
    reason: FieldOnly(['internal'])(Schema.String),
  })
  const publicChange = extract(PriceChange, 'public')
  yield* Console.log(
    Schema.decodeUnknownSync(publicChange)({
      sku: 'MUG',
      priceCents: 1100,
      reason: 'clearance',
    }),
  )
})
