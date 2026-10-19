/**
 * @title Schemas as data with SchemaRepresentation
 * @difficulty advanced
 * @summary A schema is normally code. `SchemaRepresentation` turns it into a
 * plain JSON document you can store, send, and rebuild into a working schema
 * later, or compile into TypeScript source.
 */

import { Console, Effect, Schema, SchemaRepresentation } from 'effect'

const Product = Schema.Struct({
  sku: Schema.String.check(Schema.isMinLength(3)),
  price: Schema.Number.check(Schema.isGreaterThan(0)),
  status: Schema.Literals(['active', 'archived']),
  note: Schema.optionalKey(Schema.String),
}).annotate({ identifier: 'Product' })

export const program = Effect.gen(function* () {
  // `toRepresentation` lowers a schema's AST into a document. Schemas with
  // an identifier go into its `references` table.
  const document = SchemaRepresentation.toRepresentation(Product.ast)

  // `toJson` gives a value you can store in a database or send to a client.
  // Checks are kept by id and payload, not as functions.
  const stored = JSON.stringify(SchemaRepresentation.toJson(document))
  yield* Console.log(stored.length, 'characters of JSON')
  yield* Console.log(stored.match(/"representation":\{[^}]*\}\}/g))

  // Rebuilding needs revivers: one per check or declaration id, turning the
  // stored payload back into a real check. None are installed by default, so
  // a document can only use the checks you allow.
  const restored = SchemaRepresentation.fromRepresentation(
    SchemaRepresentation.fromJson(JSON.parse(stored)),
    {
      revivers: [
        SchemaRepresentation.isMinLengthReviver,
        SchemaRepresentation.isGreaterThanReviver,
      ],
    },
  )

  // The rebuilt schema validates like the original. Its type is unknown to
  // the compiler, so give it one with `Schema.make`.
  const RestoredProduct = Schema.make<Schema.Codec<typeof Product.Type>>(
    restored.ast,
  )
  yield* Console.log(
    Schema.decodeUnknownSync(RestoredProduct)({
      sku: 'MUG',
      price: 12,
      status: 'active',
    }),
  )
  yield* Console.log(
    Schema.is(RestoredProduct)({ sku: 'X', price: 12, status: 'active' }),
  )

  // Leaving a reviver out is an error that names the missing id.
  const missing = yield* Effect.try(() =>
    SchemaRepresentation.fromRepresentation(document, { revivers: [] }),
  ).pipe(
    Effect.catch((error) => Effect.succeed(String(error.cause).split('\n')[0])),
  )
  yield* Console.log(missing)

  // The same document compiles to TypeScript source: the runtime schema and
  // its type, ready to write into a generated file.
  const code = SchemaRepresentation.toCodeDocument(
    SchemaRepresentation.toMultiDocument(document),
  )
  for (const {
    $ref,
    code: { runtime, Type },
  } of code.references.nonRecursives) {
    yield* Console.log(`export const ${$ref} = ${runtime}`)
    yield* Console.log(`export type ${$ref} = ${Type}`)
  }
})
