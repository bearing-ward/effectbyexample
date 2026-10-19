/**
 * @title Compiling schemas, JIT and AOT
 * @difficulty advanced
 * @summary By default a schema is interpreted: a generic parser walks its
 * AST for every value. The schema compilers generate a plain JavaScript
 * function specialized to one schema instead, either at runtime (JIT) or at
 * build time (AOT). Results and error messages stay the same.
 */

import { Console, Effect, Schema } from 'effect'
import { SchemaAOTCompiler, SchemaJITCompiler } from 'effect/schema'

// Both compilers are marked unstable. They pay off for schemas on a hot
// path, such as a message decoded thousands of times a second.
const OrderLine = Schema.Struct({
  sku: Schema.String,
  qty: Schema.Int.check(Schema.isGreaterThan(0)),
})

const tryDecode = (input: unknown) =>
  Schema.decodeUnknownEffect(OrderLine)(input).pipe(
    Effect.catchTag('SchemaError', (error) => Effect.succeed(error.message)),
  )

export const program = Effect.gen(function* () {
  // AOT: `compile` returns the source of a JavaScript module. Save it as a
  // file during your build, import it, and call its `install` export with
  // the same ASTs, in the same order, before decoding. Here we only look at
  // what it generated for the `is` type guard: straight-line tests on each
  // field instead of a generic walk over the AST.
  const source = SchemaAOTCompiler.compile([
    { ast: OrderLine.ast, operations: ['is'] },
  ])
  yield* Console.log(source)

  // AOT is for environments that forbid building functions from strings,
  // such as pages with a strict Content Security Policy. Where that is
  // allowed, the JIT compiler generates the same kind of code at runtime.
  // `enable` marks one schema; importing `effect/schema/SchemaJITCompiler/enable`
  // turns it on for every schema.
  SchemaJITCompiler.enable(OrderLine.ast)

  // Nothing else changes. Compilation happens lazily on first use, and if
  // it is not possible the interpreter is used instead, so decoding gives
  // the same values and the same messages either way.
  yield* Console.log(yield* tryDecode({ sku: 'MUG', qty: 2 }))
  yield* Console.log(yield* tryDecode({ sku: 'MUG', qty: 0 }))
  yield* Console.log(Schema.is(OrderLine)({ sku: 'MUG', qty: 1.5 }))
})
