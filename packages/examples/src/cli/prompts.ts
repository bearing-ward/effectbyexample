/**
 * @title Interactive prompts
 * @difficulty intermediate
 * @summary `Prompt` asks the user for input in the terminal: text with
 * validation, a menu, a yes or no question. A flag can fall back to a prompt
 * when it is missing. Because prompts read keys from the `Terminal` service,
 * a scripted terminal can drive them in a test.
 */

import {
  Cause,
  Console,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Queue,
  Stdio,
  Terminal,
} from 'effect'
import { CliOutput, Command, Flag, Prompt } from 'effect/cli'
import { ChildProcessSpawner } from 'effect/process'

// `Prompt.all` runs prompts one after another and collects the answers into
// an object. `validate` keeps asking until the input is accepted.
const signup = Prompt.all({
  name: Prompt.String({
    message: 'Your name',
    validate: (name) =>
      name.length < 2
        ? Effect.fail('At least 2 letters')
        : Effect.succeed(name),
  }),
  plan: Prompt.Select({
    message: 'Plan',
    choices: [
      { title: 'Free', value: 'free' },
      { title: 'Team', value: 'team' },
    ],
  }),
  newsletter: Prompt.Confirm({ message: 'Get the newsletter?' }),
})

// With `withFallbackPrompt`, `--team` is still a normal flag. Only when it
// is missing does the runner ask for it.
const invite = Command.make(
  'invite',
  {
    team: Flag.String('team').pipe(
      Flag.withFallbackPrompt(Prompt.String({ message: 'Team name' })),
    ),
  },
  ({ team }) => Console.log(`invited to ${team}`),
)

// A key press as the terminal reports it, and a helper for typing text.
const press = (name: string, input?: string): Terminal.UserInput => ({
  input: Option.fromNullishOr(input),
  key: { name, ctrl: false, meta: false, shift: false },
})
const type = (text: string) => [...text].map((char) => press(char, char))

export const program = Effect.gen(function* () {
  // The scripted terminal reads key presses from a queue and keeps every
  // frame the prompts draw. Frames contain ANSI codes for cursor movement,
  // so we strip them before printing.
  const keys = yield* Queue.unbounded<Terminal.UserInput, Cause.Done>()
  const frames: Array<string> = []
  const terminal = Terminal.make({
    columns: Effect.succeed(80),
    rows: Effect.succeed(24),
    readInput: Effect.succeed(keys),
    readLine: Effect.die('prompts read keys, not lines'),
    display: (text) =>
      Effect.sync(() => {
        /* oxlint-disable-next-line no-control-regex */
        frames.push(text.replace(/\u001b\[[0-9;?]*[A-Za-z]/g, ''))
      }),
  })

  // A user types "A" and Enter (too short), then "da" and Enter, moves down
  // the menu, presses Enter, and answers "y".
  yield* Queue.offerAll(keys, [
    ...type('A'),
    press('return'),
    ...type('da'),
    press('return'),
    press('down'),
    press('return'),
    press('y', 'y'),
    // Then, for the `invite` command, a team name.
    ...type('Design'),
    press('return'),
  ])

  const services = Layer.mergeAll(
    FileSystem.layerNoop({}),
    Path.layer,
    Stdio.layerTest({}),
    Layer.succeed(Terminal.Terminal, terminal),
    Layer.succeed(
      ChildProcessSpawner.ChildProcessSpawner,
      ChildProcessSpawner.make(() =>
        Effect.die('no processes in this example'),
      ),
    ),
    CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
  )

  yield* Effect.gen(function* () {
    // A prompt is an Effect. Running it waits for the answers.
    const answers = yield* signup
    yield* Console.log(answers)

    // Passing `--team` skips the prompt. Leaving it out asks for it.
    const run = Command.runWith(invite, { version: '1.0.0' })
    yield* run(['--team', 'Billing'])
    yield* run([])
  }).pipe(Effect.provide(services))

  // The frames show what the user saw: the validation message, and each
  // answer once it was submitted.
  for (const frame of frames) {
    if (frame.startsWith('✔') || frame.includes('\n›')) {
      yield* Console.log(frame.trimEnd())
    }
  }
})
