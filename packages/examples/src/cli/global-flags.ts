/**
 * @title Global flags
 * @difficulty intermediate
 * @summary Global flags apply to a command and everything below it. A setting
 * flag hands a value to any handler through the context, and an action flag
 * runs instead of the command, like `--help`. `CliConfig` picks which
 * built-in global flags exist at all.
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
import { CliConfig, CliOutput, Command, Flag, GlobalFlag } from 'effect/cli'
import { ChildProcessSpawner } from 'effect/process'

// A `Setting` is a flag and a service in one. The runner parses `--region`
// and provides the value, so handlers read it with `yield* Region`.
const Region = GlobalFlag.Setting('region')({
  flag: Flag.Literals('region', ['eu', 'us']).pipe(
    Flag.withDescription('Data center to talk to'),
    Flag.withDefault('eu'),
  ),
})

// An `Action` runs its own effect and then stops. The command handler does
// not run. The built-in `--help` and `--version` are actions.
const Changelog = GlobalFlag.Action({
  flag: Flag.Boolean('changelog').pipe(
    Flag.withDescription('Print recent changes and exit'),
    Flag.withDefault(false),
  ),
  run: (_, { command, version }) =>
    Console.log(`${command.name} ${version}: added the status subcommand`),
})

const status = Command.make(
  'status',
  {},
  Effect.fn(function* () {
    const region = yield* Region
    yield* Console.log(`all services healthy in ${region}`)
  }),
)

const release = Command.make(
  'release',
  { tag: Flag.String('tag') },
  Effect.fn(function* ({ tag }) {
    const region = yield* Region
    yield* Console.log(`releasing ${tag} to ${region}`)
  }),
)

// `withGlobalFlags` attaches the flags to the root, so every subcommand
// accepts them. It also removes the `Region` requirement from the type: the
// runner provides it.
const deploy = Command.make('deploy').pipe(
  Command.withSubcommands([status, release]),
  Command.withGlobalFlags([Region, Changelog]),
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
  CliOutput.layer(CliOutput.defaultFormatter({ colors: false })),
  // By default the runner adds `--help`, `--version`, `--wizard`,
  // `--completions` and `--log-level`. This tool keeps only the first two.
  CliConfig.layer({ builtIns: [GlobalFlag.Help, GlobalFlag.Version] }),
)

export const program = Effect.gen(function* () {
  const run = Command.runWith(deploy, { version: '3.1.0' })

  // Global flags can go anywhere on the line.
  yield* run(['status'])
  yield* run(['--region', 'us', 'status'])
  yield* run(['release', '--tag', 'v42', '--region', 'us'])

  // The action flag runs and the subcommand does not.
  yield* run(['release', '--tag', 'v43', '--changelog'])

  // Help lists the custom global flags next to the built-ins that are left.
  yield* run(['status', '--help'])

  // `--completions` was removed, so it is now an unknown flag, and `bash`
  // reads as an unknown subcommand. The runner prints the help and both
  // errors, then fails with `ShowHelp`.
  yield* run(['--completions', 'bash']).pipe(
    Effect.catchTag('ShowHelp', (help) =>
      Console.log(
        `rejected: ${help.errors.map((error) => error._tag).join(', ')}`,
      ),
    ),
  )
}).pipe(Effect.provide(services))
