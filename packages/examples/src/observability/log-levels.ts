/**
 * @title Filtering by log level
 * @difficulty beginner
 * @summary Every log entry has a level, from `Trace` up to `Fatal`. The
 * `MinimumLogLevel` reference decides which entries are logged at all, and
 * the `LogLevel` module lets a single logger react only to the levels it
 * cares about.
 */

import { Console, Effect, Layer, Logger, LogLevel, References } from 'effect'

const pageLogger = Logger.withConsoleLog(
  Logger.make(
    ({ logLevel, message }) => `${logLevel.padEnd(5)} ${String(message)}`,
  ),
)

// A second logger that pages the on-call engineer. It ignores anything
// below `Error`, using the comparisons from `LogLevel`.
const page = Logger.withConsoleLog(
  Logger.make(({ message }) => `PAGE  on-call: ${String(message)}`),
)
const pager = Logger.make((entry) => {
  if (LogLevel.isGreaterThanOrEqualTo(entry.logLevel, 'Error')) {
    page.log(entry)
  }
})

const syncInventory = Effect.gen(function* () {
  yield* Effect.logTrace('opening connection')
  yield* Effect.logDebug('fetched 120 rows')
  yield* Effect.logInfo('inventory synced')
  yield* Effect.logWarning('3 SKUs have no price')
  yield* Effect.logError('warehouse B unreachable')
})

export const program = Effect.gen(function* () {
  // Levels are ordered. `LogLevel.Order` sorts them, with `All` and `None`
  // at the ends as the "log everything" and "log nothing" settings.
  yield* Console.log([...LogLevel.values].sort(LogLevel.Order).join(' < '))

  // With the default minimum level, `Info`, trace and debug entries are
  // dropped. The pager prints only the error.
  yield* Console.log('--- default minimum: Info')
  yield* syncInventory

  // Provide `MinimumLogLevel` to change the threshold for one part of the
  // program, for example while debugging a single job.
  yield* Console.log('--- minimum: Debug')
  yield* syncInventory.pipe(
    Effect.provideService(References.MinimumLogLevel, 'Debug'),
  )

  // `LogLevel.isEnabled` asks whether a level would be logged right now.
  // Use it to skip building an expensive message that would be thrown away.
  const report = Effect.gen(function* () {
    if (yield* LogLevel.isEnabled('Debug')) {
      yield* Effect.logDebug('full inventory dump')
    } else {
      yield* Console.log('debug is off, skipping the dump')
    }
  })
  yield* report
  yield* report.pipe(Effect.provideService(References.MinimumLogLevel, 'Debug'))
}).pipe(
  // The same setting works as a layer, which is how an app would read it
  // from configuration at startup.
  Effect.provide(
    Layer.merge(
      Logger.layer([pageLogger, pager]),
      Layer.succeed(References.MinimumLogLevel, 'Info'),
    ),
  ),
)
