/**
 * @title Reporting errors to a tracker
 * @difficulty intermediate
 * @summary An `ErrorReporter` forwards failures to an error tracker such as
 * Sentry, without changing how your program handles them. Errors can say how
 * severe they are, attach extra attributes, or opt out of reporting entirely.
 */

import { Console, Effect, ErrorReporter, Schema } from 'effect'

// `ErrorReporter` is marked unstable in Effect 4.0, so its API may change.

// Expected and harmless: a missing product should not page anyone. The
// `ErrorReporter.ignore` key opts this error out of every reporter.
class ProductNotFound extends Schema.TaggedError<ProductNotFound>()(
  'ProductNotFound',
  { sku: Schema.String },
) {
  readonly [ErrorReporter.ignore] = true
}

class CacheStampede extends Schema.TaggedError<CacheStampede>()(
  'CacheStampede',
  { message: Schema.String },
) {}

// Worth knowing about. `severity` overrides the default `Info` level, and
// `attributes` adds context the tracker can index.
class PaymentProviderDown extends Schema.TaggedError<PaymentProviderDown>()(
  'PaymentProviderDown',
  { provider: Schema.String, message: Schema.String },
) {
  readonly [ErrorReporter.severity] = 'Error' as const
  get [ErrorReporter.attributes]() {
    return { provider: this.provider }
  }
}

export const program = Effect.gen(function* () {
  // A reporter is a callback. A real one would send to your tracker; this one
  // keeps the reports so we can print them.
  const reports: Array<string> = []
  const tracker = ErrorReporter.make(({ error, severity, attributes }) => {
    reports.push(`[${severity}] ${error.message} ${JSON.stringify(attributes)}`)
  })

  // `withErrorReporting` reports a failure as it passes, then lets it
  // continue. The `catch` after it still sees every error.
  const checkout = (failure: ProductNotFound | PaymentProviderDown) =>
    Effect.fail(failure).pipe(
      Effect.withErrorReporting,
      Effect.catch((error) => Effect.succeed(`handled ${error._tag}`)),
    )

  yield* Effect.gen(function* () {
    yield* Console.log(yield* checkout(new ProductNotFound({ sku: 'mug' })))
    yield* Console.log(
      yield* checkout(
        new PaymentProviderDown({
          provider: 'acme-pay',
          message: 'acme-pay timed out',
        }),
      ),
    )

    // With `defectsOnly`, expected errors are skipped and only bugs are
    // reported. The `beta-pay` outage below never reaches the tracker.
    const onlyBugs = Effect.withErrorReporting({ defectsOnly: true })
    const skipped = yield* Effect.fail(
      new PaymentProviderDown({
        provider: 'beta-pay',
        message: 'beta-pay timed out',
      }),
    ).pipe(
      onlyBugs,
      Effect.catch(() => Effect.succeed('handled beta-pay outage')),
    )
    yield* Console.log(skipped)

    const bug = yield* Effect.die(new Error('negative total')).pipe(
      onlyBugs,
      Effect.catchDefect(() => Effect.succeed('handled defect')),
    )
    yield* Console.log(bug)

    // `ErrorReporter.report` sends a cause by hand, for a failure you have
    // already recovered from but still want to track.
    const recovered = yield* Effect.fail(
      new CacheStampede({ message: 'cache miss storm' }),
    ).pipe(
      Effect.catchCause((cause) =>
        ErrorReporter.report(cause).pipe(Effect.as('served from database')),
      ),
    )
    yield* Console.log(recovered)
  }).pipe(
    // `ErrorReporter.layer` installs reporters for everything inside it.
    // Without one, reporting does nothing.
    Effect.provide(ErrorReporter.layer([tracker])),
  )

  // The ignored `ProductNotFound` is missing from the reports.
  yield* Console.log('reports:')
  for (const report of reports) {
    yield* Console.log(report)
  }
})
