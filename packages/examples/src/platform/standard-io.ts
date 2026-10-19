/**
 * @title Standard input and output
 * @difficulty intermediate
 * @summary `Stdio` gives a program its arguments, standard input as a byte
 * stream, and standard output as a sink. `Terminal` adds interactive
 * prompts. Both are services, so a test can script the input and capture the
 * output instead of touching the real process.
 */

import {
  Console,
  Effect,
  Layer,
  Queue,
  Sink,
  Stdio,
  Stream,
  Terminal,
} from 'effect'

// A small command-line tool: it reads lines from standard input, keeps
// those that contain the word given as an argument, and writes them out.
const grep = Effect.gen(function* () {
  const stdio = yield* Stdio.Stdio
  const [pattern = ''] = yield* stdio.args
  yield* stdio.stdin.pipe(
    Stream.decodeText,
    Stream.splitLines,
    Stream.filter((line) => line.includes(pattern)),
    Stream.map((line) => `${line}\n`),
    Stream.run(stdio.stdout()),
  )
})

// An interactive step: ask questions until the user quits. `readLine` fails
// with a `QuitError` when the user presses Ctrl+C or Ctrl+D.
const survey = Effect.gen(function* () {
  const terminal = yield* Terminal.Terminal
  const answers: Array<string> = []
  while (true) {
    yield* terminal.display('Favourite language? ')
    const answer = yield* terminal.readLine.pipe(
      Effect.catchTag('QuitError', () => Effect.succeed(undefined)),
    )
    if (answer === undefined) return answers
    answers.push(answer)
  }
})

export const program = Effect.gen(function* () {
  // `Stdio.layerTest` supplies fixed arguments and input, and collects what
  // the program writes. In production, `NodeServices.layer` from
  // `@effect/platform-node` provides the real process streams.
  // Input arrives in arbitrary chunks, so a line can be split across two.
  // `Stream.splitLines` in the tool joins it back together.
  const written: Array<string | Uint8Array> = []
  const StdioTest = Stdio.layerTest({
    args: Effect.succeed(['error']),
    stdin: Stream.make('ok: started\nerror: di', 'sk full\nok: done\n').pipe(
      Stream.encodeText,
    ),
    stdout: () =>
      Sink.forEach((chunk: string | Uint8Array) =>
        Effect.sync(() => void written.push(chunk)),
      ),
  })
  yield* grep.pipe(Effect.provide(StdioTest))
  yield* Console.log(written.join('').trimEnd())

  // A scripted terminal: two answers, then the user quits. `Terminal.make`
  // builds the service from its operations.
  const script: Array<string> = ['TypeScript', 'OCaml']
  const shown: Array<string> = []
  const TerminalTest = Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Queue.unbounded<Terminal.UserInput, never>(),
      readLine: Effect.suspend(() => {
        const next = script.shift()
        return next === undefined
          ? Effect.fail(new Terminal.QuitError())
          : Effect.succeed(next)
      }),
      display: (text) => Effect.sync(() => void shown.push(text)),
    }),
  )
  const answers = yield* survey.pipe(Effect.provide(TerminalTest))
  yield* Console.log(answers, `${shown.length} prompts`)
})
