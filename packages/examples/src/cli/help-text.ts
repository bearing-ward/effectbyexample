/**
 * @title Generated help
 * @difficulty beginner
 * @summary Every command gets `--help` for free. The text comes from the same
 * definitions that parse the input, so it cannot drift out of date. A custom
 * formatter can render the same information in another format, such as
 * Markdown for a docs page.
 */

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
import { Argument, CliOutput, Command, Flag, HelpDoc } from 'effect/cli'
import { ChildProcessSpawner } from 'effect/process'

// Descriptions on the command, its argument, and its flags all show up in
// the help. So do examples added with `withExamples`.
const backup = Command.make(
  'backup',
  {
    database: Argument.String('database').pipe(
      Argument.withDescription('Name of the database to back up'),
    ),
    keep: Flag.Int('keep').pipe(
      Flag.withDescription('How many old backups to keep'),
      Flag.withDefault(7),
    ),
    compress: Flag.Boolean('compress').pipe(
      Flag.withAlias('z'),
      Flag.withDescription('Compress the backup with gzip'),
    ),
  },
  () => Effect.void,
).pipe(
  Command.withDescription('Copy a database to the backup bucket'),
  Command.withExamples([
    { command: 'backup orders --keep 30 -z', description: 'Monthly backup' },
  ]),
)

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
)

// Before printing, the runner builds a `HelpDoc`: a plain object with the
// usage line, description, flags, arguments, subcommands, and examples. A
// formatter turns it into text. This one renders a Markdown table.
const markdown = (doc: HelpDoc.HelpDoc): string =>
  [
    `## ${doc.usage}`,
    '',
    doc.description,
    '',
    '| Flag | Type | Description |',
    '| --- | --- | --- |',
    ...doc.flags.map(
      (flag) =>
        `| \`--${flag.name}\` | ${flag.type} | ${Option.getOrElse(flag.description, () => '')} |`,
    ),
  ].join('\n')

export const program = Effect.gen(function* () {
  const run = Command.runWith(backup, { version: '2.0.0' })

  // The default formatter, here without colors. The built-in global flags
  // such as `--version` and `--completions` are listed too.
  yield* run(['--help']).pipe(
    Effect.provide(
      CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
    ),
  )

  // `CliOutput.layer` swaps in a formatter. Spreading the default keeps its
  // error and version formatting and replaces only the help.
  yield* Console.log('---')
  yield* run(['--help']).pipe(
    Effect.provide(
      CliOutput.layer({
        ...CliOutput.defaultFormatter({ colors: false }),
        formatHelpDoc: markdown,
      }),
    ),
  )
}).pipe(Effect.provide(services))
