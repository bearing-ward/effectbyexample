/**
 * @title Shell completions
 * @difficulty intermediate
 * @summary Every command can print a tab-completion script for bash, zsh,
 * fish, or PowerShell. The script is generated from the command definition,
 * so subcommands, flags, choices, and file arguments complete correctly.
 */

import {
  Console,
  Effect,
  FileSystem,
  Layer,
  Path,
  Stdio,
  Terminal,
} from 'effect'
import { Argument, CliOutput, Command, Completions, Flag } from 'effect/cli'
import { ChildProcessSpawner } from 'effect/process'

// A `File` argument completes file names, and a `Literals` flag completes its
// choices. The descriptions become hints in shells that show them.
const notes = Command.make('notes', {
  file: Argument.File('file').pipe(Argument.withDescription('Note to open')),
  format: Flag.Literals('format', ['md', 'txt']).pipe(
    Flag.withAlias('f'),
    Flag.withDescription('Output format'),
    Flag.withDefault('md'),
  ),
})

const services = Layer.mergeAll(
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
  // `--completions <shell>` is a built-in global flag. Users run it once and
  // save the output where their shell looks for completions. The header of
  // the script says where that is.
  yield* Command.runWith(notes, { version: '1.0.0' })(['--completions', 'zsh'])

  // Under the hood the runner turns the command into a plain
  // `CommandDescriptor` and passes it to `Completions.generate`. You can call
  // it directly, for example to write completion files at build time.
  const descriptor: Completions.CommandDescriptor = {
    name: 'notes',
    description: undefined,
    flags: [
      {
        name: 'format',
        aliases: ['f'],
        description: 'Output format',
        type: { _tag: 'Choice', values: ['md', 'txt'] },
      },
    ],
    arguments: [
      {
        name: 'file',
        description: 'Note to open',
        required: true,
        variadic: false,
        type: { _tag: 'Path', pathType: 'file' },
      },
    ],
    subcommands: [],
  }
  yield* Console.log(Completions.generate('notes', 'fish', descriptor))

  // The bash and PowerShell scripts carry more helper code, so they are much
  // longer for the same command.
  for (const shell of ['bash', 'zsh', 'fish', 'powershell'] as const) {
    const lines = Completions.generate('notes', shell, descriptor).split('\n')
    yield* Console.log(`${shell}: ${lines.length} lines`)
  }
}).pipe(Effect.provide(services))
