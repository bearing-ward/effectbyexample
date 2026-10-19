/**
 * @title References and defaults
 * @difficulty intermediate
 * @summary A `Context.Reference` is a service with a default value, so code
 * can read it without anyone providing it. Effect's own runtime settings,
 * such as the minimum log level, are references too, collected in the
 * `References` module.
 */

import { Console, Context, Effect, Logger, References } from 'effect'

// A reference needs a key and a `defaultValue` function. Feature flags and
// tuning knobs are a good fit: most code wants the default.
const CheckoutFlags = Context.Reference<{ readonly oneClick: boolean }>(
  'app/CheckoutFlags',
  { defaultValue: () => ({ oneClick: false }) },
)

// Reading a reference does not add a requirement. The type of this effect
// is `Effect<string>`, with nothing left to provide.
const checkoutButton = Effect.gen(function* () {
  const flags = yield* CheckoutFlags
  return flags.oneClick ? 'Buy now' : 'Add to cart'
})

export const program = Effect.gen(function* () {
  yield* Console.log(yield* checkoutButton)

  // Providing a value overrides the default, only for that effect.
  yield* Console.log(
    yield* checkoutButton.pipe(
      Effect.provideService(CheckoutFlags, { oneClick: true }),
    ),
  )

  // The `References` module holds the references the runtime itself reads.
  // `MinimumLogLevel` decides which log calls are kept.
  yield* Console.log('minimum log level:', yield* References.MinimumLogLevel)

  // `CurrentLoggers` is the set of loggers that receive log entries. We
  // swap in one that collects lines, so the output has no timestamps.
  const lines: Array<string> = []
  const collect = Logger.make(({ logLevel, message }) => {
    lines.push(
      `${logLevel}: ${Array.isArray(message) ? message.join(' ') : message}`,
    )
  })

  const work = Effect.gen(function* () {
    yield* Effect.logDebug('loading cart')
    yield* Effect.logInfo('order placed')
  })

  // With the default minimum level, `Info`, the debug line is dropped.
  yield* work.pipe(
    Effect.provideService(References.CurrentLoggers, new Set([collect])),
  )

  // Lowering the minimum level for one effect keeps the debug line.
  yield* work.pipe(
    Effect.provideService(References.CurrentLoggers, new Set([collect])),
    Effect.provideService(References.MinimumLogLevel, 'Debug'),
  )
  yield* Console.log(lines)
})
