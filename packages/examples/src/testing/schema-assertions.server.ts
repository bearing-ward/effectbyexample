/**
 * @title Testing schemas with TestSchema
 * @difficulty intermediate
 * @summary Schemas are code too, and their transformations can have bugs.
 * `TestSchema.Asserts` bundles the checks you want for one schema: what it
 * decodes, what it rejects and with which message, what it encodes, and
 * whether every value survives a round trip.
 */

// `TestSchema` uses `node:assert` under the hood, so this example runs on the
// server. The module is marked unstable.
import { Console, Effect, Schema, SchemaTransformation } from 'effect'
import { TestSchema } from 'effect/testing'

// A product row stores its price as a string of cents, `"1999"`. The app
// works in dollars, `19.99`.
const DollarsFromCents = Schema.String.pipe(
  Schema.decodeTo(
    Schema.Finite,
    SchemaTransformation.transform({
      decode: (cents) => Number(cents) / 100,
      encode: (dollars) => String(Math.round(dollars * 100)),
    }),
  ),
)

const Product = Schema.Struct({
  sku: Schema.String.check(Schema.isPattern(/^SKU-\d+$/)),
  price: DollarsFromCents,
})

// An assertion that does not hold is a defect, as in any test runner. This
// helper reports either outcome so the example can show both.
const report = (label: string, assertion: Effect.Effect<void>) =>
  assertion.pipe(
    Effect.as(`${label}: ok`),
    Effect.catchDefect((defect) =>
      Effect.succeed(`${label}: FAILED\n${String(defect)}`),
    ),
    Effect.flatMap(Console.log),
  )

export const program = Effect.gen(function* () {
  const asserts = new TestSchema.Asserts(Product)

  // `decoding()` asserts what an input decodes to, or the exact message it
  // fails with. The `Effect` variants run inside your program; the plain
  // ones return a Promise for `await` in any test runner.
  yield* report(
    'decodes a row',
    asserts
      .decoding()
      .succeedEffect(
        { sku: 'SKU-1', price: '1999' },
        { sku: 'SKU-1', price: 19.99 },
      ),
  )
  yield* report(
    'rejects a bad sku',
    asserts
      .decoding()
      .failEffect(
        { sku: 'apple', price: '100' },
        'Expected a string matching the RegExp ^SKU-\\d+$\n  at ["sku"]',
      ),
  )

  // `encoding()` checks the other direction.
  yield* report(
    'encodes a product',
    asserts
      .encoding()
      .succeedEffect(
        { sku: 'SKU-2', price: 5 },
        { sku: 'SKU-2', price: '500' },
      ),
  )

  // `verifyRoundTripEffect` generates products with `Arbitrary`, encodes
  // them, decodes them back, and compares. It finds what the hand-written
  // cases missed: a price smaller than one cent does not survive rounding to
  // whole cents. The failure message includes the shrunk input.
  yield* report('round trip', asserts.verifyRoundTripEffect({ seed: 1 }))
})
