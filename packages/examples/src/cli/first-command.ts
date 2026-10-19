/**
 * @title A first command
 * @difficulty beginner
 * @summary A `Command` declares its arguments and flags with types, and the
 * runner parses raw command-line words into a typed object for your handler.
 * Running it against a fixed list of words makes it easy to test.
 */

// The `effect/cli` modules are marked `@stability unstable`: their API may
// still change between minor releases.
import {
  Console,
  Effect,
  FileSystem,
  Layer,
  Option,
  Path,
  Stdio,
  Terminal,
} from 'effect'
import { Argument, CliOutput, Command, Flag } from 'effect/cli'
import { ChildProcessSpawner } from 'effect/process'

// An `Argument` is positional. A `Flag` is named, like `--priority high`.
// Each one parses its text into a typed value, and the combinators add an
// alias, a default, or make it optional.
const add = Command.make(
  'add',
  {
    title: Argument.String('title'),
    priority: Flag.Literals('priority', ['low', 'normal', 'high']).pipe(
      Flag.withAlias('p'),
      Flag.withDefault('normal'),
    ),
    estimate: Flag.Int('estimate').pipe(Flag.optional),
    done: Flag.Boolean('done').pipe(Flag.withDefault(false)),
  },
  // The handler receives the parsed input. `priority` has the type
  // `'low' | 'normal' | 'high'` and `estimate` is an `Option<number>`.
  ({ title, priority, estimate, done }) =>
    Console.log(
      `added "${title}" priority=${priority} done=${done}`,
      Option.match(estimate, {
        onNone: () => 'no estimate',
        onSome: (hours) => `estimate=${hours}h`,
      }),
    ),
)

// The runner needs a few platform services: a terminal, a file system,
// standard input and output, and a process spawner. A real app provides them
// all with `NodeServices.layer` from `@effect/platform-node`. Here small test
// versions keep everything in memory, and a formatter without colors keeps the
// output plain text.
const CliTest = Layer.mergeAll(
  FileSystem.layerNoop({}),
  Path.layer,
  Stdio.layerTest({}),
  Layer.succeed(
    Terminal.Terminal,
    Terminal.make({
      columns: Effect.succeed(80),
      rows: Effect.succeed(24),
      readInput: Effect.die('no input in this example'),
      readLine: Effect.die('no input in this example'),
      display: () => Effect.void,
    }),
  ),
  Layer.succeed(
    ChildProcessSpawner.ChildProcessSpawner,
    ChildProcessSpawner.make(() => Effect.die('no processes in this example')),
  ),
  CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
)

export const program = Effect.gen(function* () {
  // `Command.runWith` returns a function from the argument words to an
  // Effect. These are the words after the program name, as in
  // `todo "Water the plants" -p high --estimate 2`.
  const run = Command.runWith(add, { version: '1.4.0' })
  yield* run(['Water the plants', '-p', 'high', '--estimate', '2'])

  // Leaving flags out gives their defaults. A bare `--done` means true.
  yield* run(['Call the bank', '--done'])

  // Flags can come before the argument, and `--name=value` works too.
  yield* run(['--priority=low', 'Read a book'])

  // `--version` is built in. It prints the command name and the version
  // passed to `runWith`, and the handler does not run.
  yield* run(['--version'])

  // In a real program `Command.run` reads the words from the `Stdio` service
  // instead, which the Node platform fills from `process.argv`.
  yield* Command.run(add, { version: '1.4.0' }).pipe(
    Effect.provide(Stdio.layerTest({ args: Effect.succeed(['Pay rent']) })),
  )
}).pipe(Effect.provide(CliTest))
