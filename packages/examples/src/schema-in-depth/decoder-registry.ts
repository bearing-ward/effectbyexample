/**
 * @title Installing a decoder with SchemaCompiler
 * @difficulty advanced
 * @summary The JIT and AOT compilers do not add a new parser API. They put
 * decoders into a shared registry keyed by AST, and every `Schema` parser
 * looks there first. `SchemaCompiler.set` lets you install one by hand.
 */

import { Console, Effect, Schema, SchemaIssue } from 'effect'
import { SchemaCompiler } from 'effect/schema'

// `SchemaCompiler` is a low-level, unstable API for library and tool
// authors. Here it backs a SKU schema with a hand-written decoder.
const Sku = Schema.String.check(Schema.isPattern(/^SKU-\d+$/))
const isSku = (input: unknown): input is string =>
  typeof input === 'string' && /^SKU-\d+$/.test(input)

// A schema that uses `Sku` as a field picks up the installed decoder too,
// because the registry is keyed by the field's AST node.
const OrderLine = Schema.Struct({ sku: Sku, qty: Schema.Int })

const tryDecode = (input: unknown) =>
  Schema.decodeUnknownEffect(OrderLine)(input).pipe(
    Effect.catchTag('SchemaError', (error) => Effect.succeed(error.message)),
  )

export const program = Effect.gen(function* () {
  // Install before the first parse. The decoder you install is trusted to
  // behave exactly like the schema.
  SchemaCompiler.set(Sku.ast, {
    // Optional fast paths. `is` answers type guards; `decode` returns the
    // value, or `SchemaCompiler.invalid` to ask for the detailed decoder.
    is: isSku,
    decode: (input) => (isSku(input) ? input : SchemaCompiler.invalid),
    // The required decoder: succeed with the value or fail with an `Issue`.
    // A real compiler reproduces the schema's own messages; this one uses its
    // own wording so you can see that it ran.
    decodeEffect: (input) =>
      isSku(input)
        ? Effect.succeed(input)
        : Effect.fail(
            new SchemaIssue.InvalidValue({
              message: 'Expected a SKU such as SKU-42',
            }),
          ),
  })

  yield* Console.log(Schema.is(Sku)('SKU-42'), Schema.is(Sku)('mug'))
  yield* Console.log(yield* tryDecode({ sku: 'SKU-7', qty: 2 }))

  // The failure comes from `decodeEffect`, at the right path.
  yield* Console.log(yield* tryDecode({ sku: 'mug', qty: 2 }))
})
