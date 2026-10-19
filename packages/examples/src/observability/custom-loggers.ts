/**
 * @title Writing custom loggers
 * @difficulty intermediate
 * @summary A `Logger` is a function from a log entry to some output. Build
 * one with `Logger.make`, reshape a built-in one with `Logger.map`, and
 * install several at once so the same entry goes to the console and to an
 * in-memory list.
 */

import { Console, Effect, Logger } from 'effect'

// `Logger.make` receives every entry: the message, the level, the cause,
// the fiber that logged it, and the date. Whatever it returns is the
// logger's output. This one turns the entry into a single line of text.
const lineFormat = Logger.make(
  ({ logLevel, message }) =>
    `[${logLevel.toLowerCase()}] ${[message].flat().join(' ')}`,
)

// A logger that returns a string does not print anything yet.
// `withLeveledConsole` sends each output to the console method that matches
// its level: warnings to `console.warn`, errors to `console.error`.
const consoleLogger = Logger.withLeveledConsole(lineFormat)

// `formatStructured` is a built-in logger whose output is an object with the
// level, message, annotations, spans, timestamp and fiber ID. `Logger.map`
// transforms that output. Here it drops the timestamp, the fiber ID and the
// span timings, then stores the rest in a list, as a test or an audit trail
// might.
const memoryLogger = (captured: Array<unknown>) =>
  Logger.formatStructured.pipe(
    Logger.map(({ timestamp, fiberId, spans, ...entry }) => {
      captured.push(entry)
    }),
  )

const placeOrder = Effect.gen(function* () {
  yield* Effect.logInfo('order placed', 'ord-7')
  yield* Effect.logWarning('payment retried').pipe(
    Effect.annotateLogs('attempt', 2),
  )
  yield* Effect.logError('shipping label failed')
})

export const program = Effect.gen(function* () {
  // `Logger.layer` takes a list of loggers. Every entry goes to all of them.
  const captured: Array<unknown> = []
  yield* placeOrder.pipe(
    Effect.provide(Logger.layer([consoleLogger, memoryLogger(captured)])),
  )

  // The memory logger kept the structured form of the same three entries.
  yield* Console.log(`captured ${captured.length} entries`)
  for (const entry of captured) {
    yield* Console.log(entry)
  }

  // By default `Logger.layer` replaces the current loggers, which is why
  // the block above logged only to its two. With `mergeWithExisting: true`
  // it adds to them instead, so this entry reaches both the program-wide
  // `consoleLogger` and a second, shouting logger.
  const shoutLogger = Logger.withConsoleLog(
    Logger.map(lineFormat, (line) => line.toUpperCase()),
  )
  yield* Effect.logInfo('order shipped').pipe(
    Effect.provide(Logger.layer([shoutLogger], { mergeWithExisting: true })),
  )
}).pipe(Effect.provide(Logger.layer([consoleLogger])))
