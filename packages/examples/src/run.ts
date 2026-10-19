import { Cause, Console, Effect, Exit } from 'effect'

import type { Output, OutputLevel, OutputLine } from './example.ts'
import { formatArguments } from './format.ts'

export type Program = Effect.Effect<void, unknown>

const capturingConsole = (lines: Array<OutputLine>): Console.Console => {
  const write =
    (level: OutputLevel) =>
    (...values: ReadonlyArray<unknown>) => {
      lines.push({ level, text: formatArguments(values) })
    }
  const ignore = () => undefined
  return {
    assert: (condition, ...values) => {
      if (!condition) {
        write('error')('Assertion failed:', ...values)
      }
    },
    clear: ignore,
    count: ignore,
    countReset: ignore,
    debug: write('log'),
    dir: (item) => write('log')(item),
    dirxml: write('log'),
    error: write('error'),
    group: write('log'),
    groupCollapsed: write('log'),
    groupEnd: ignore,
    info: write('info'),
    log: write('log'),
    table: (data) => write('log')(data),
    time: ignore,
    timeEnd: ignore,
    timeLog: ignore,
    trace: write('log'),
    warn: write('warn'),
  }
}

/** Runs an example program and collects everything it printed. */
export const runProgram = (program: Program): Effect.Effect<Output> =>
  Effect.suspend(() => {
    const lines: Array<OutputLine> = []
    return program.pipe(
      Effect.provideService(Console.Console, capturingConsole(lines)),
      Effect.exit,
      Effect.map((exit) =>
        Exit.isSuccess(exit)
          ? { outcome: 'succeeded' as const, lines }
          : {
              outcome: 'failed' as const,
              lines: [
                ...lines,
                { level: 'error' as const, text: Cause.pretty(exit.cause) },
              ],
            },
      ),
    )
  })
