/**
 * @title Logging with levels and annotations
 * @difficulty beginner
 * @summary `Effect.log` and its level variants write structured log entries
 * through whatever loggers the program has installed. Annotations attach
 * key-value context, such as an order ID, to every entry inside a block.
 */

import { Cause, Effect, Logger, References } from 'effect'

// The default logger prints a timestamp and a fiber ID on every line, which
// would change on each run. This page swaps in a small logger that prints
// the level, the message, any failure cause, and the annotations. The next
// example covers writing loggers like this one.
const pageLogger = Logger.withConsoleLog(
  Logger.make(({ logLevel, message, cause, fiber }) => {
    const errors = Cause.prettyErrors(cause).map((error) => error.message)
    const annotations = fiber.getRef(References.CurrentLogAnnotations)
    const context = Object.entries(annotations).map(
      ([key, value]) => `${key}=${String(value)}`,
    )
    const failure = errors.length > 0 ? [`cause=${errors.join(',')}`] : []
    return [logLevel.toUpperCase(), message, failure, context].flat().join(' ')
  }),
)

const checkout = (orderId: string) =>
  Effect.gen(function* () {
    // `Effect.log` logs at the `Info` level. Pass several values and the
    // logger receives them all as the message.
    yield* Effect.log('checkout started for', orderId)

    // Each level has its own function. `logWarning` and `logError` mark
    // entries that need attention.
    yield* Effect.logWarning('stock is low for SKU-42')

    // `logDebug` is below the default minimum level, `Info`, so this entry
    // is dropped before it reaches any logger.
    yield* Effect.logDebug('cart contents loaded')

    // `annotateLogs` adds context to every entry logged inside the effect
    // it wraps, without passing the values to each call.
    yield* Effect.log('card charged').pipe(
      Effect.annotateLogs({ provider: 'acme-pay', amountCents: 4999 }),
    )
  }).pipe(
    // Annotations nest: these apply to every entry in `checkout`.
    Effect.annotateLogs('orderId', orderId),
  )

export const program = Effect.gen(function* () {
  yield* checkout('ord-1001')

  // A failing effect can be logged with its cause. `tapCause` runs on the
  // failure without handling it. When a `Cause` is among the values passed
  // to `logError`, the logger receives it separately from the message.
  yield* Effect.fail('card declined').pipe(
    Effect.tapCause((cause) => Effect.logError('payment failed', cause)),
    Effect.ignore,
  )
}).pipe(
  // `Logger.layer` replaces the installed loggers for this program.
  Effect.provide(Logger.layer([pageLogger])),
)
