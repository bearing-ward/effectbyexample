/**
 * @title Subcommands and shared flags
 * @difficulty intermediate
 * @summary Larger tools split their work into subcommands, like `git commit`
 * and `git push`. A parent command can share flags with all of its
 * subcommands, and each subcommand reads them by yielding the parent.
 */

import {
  Console,
  Effect,
  FileSystem,
  Layer,
  Path,
  Ref,
  Stdio,
  Terminal,
} from 'effect'
import { Argument, CliOutput, Command, Flag } from 'effect/cli'
import { ChildProcessSpawner } from 'effect/process'

// The root command declares `--list` once with `withSharedFlags`. Every
// subcommand accepts it, before or after the subcommand name.
const todo = Command.make('todo').pipe(
  Command.withSharedFlags({
    list: Flag.String('list').pipe(
      Flag.withAlias('l'),
      Flag.withDefault('inbox'),
    ),
  }),
)

const makeApp = (store: Ref.Ref<ReadonlyArray<string>>) => {
  // A command is also an Effect. Yielding `todo` inside a subcommand handler
  // gives the parent's parsed input, here `{ list: string }`.
  const add = Command.make(
    'add',
    { title: Argument.String('title') },
    Effect.fn(function* ({ title }) {
      const { list } = yield* todo
      yield* Ref.update(store, (items) => [...items, `${list}: ${title}`])
      yield* Console.log(`added "${title}" to ${list}`)
    }),
  )

  // `withAlias` lets users type `ls` instead of `list`.
  const list = Command.make(
    'list',
    { all: Flag.Boolean('all').pipe(Flag.withDefault(false)) },
    Effect.fn(function* ({ all }) {
      const { list } = yield* todo
      const items = yield* Ref.get(store)
      const shown = all
        ? items
        : items.filter((item) => item.startsWith(`${list}:`))
      yield* Console.log(`${all ? 'all lists' : list}: ${shown.length} items`)
      for (const item of shown) yield* Console.log(`  - ${item}`)
    }),
  ).pipe(Command.withAlias('ls'))

  // `withSubcommands` attaches the children. The parent has no handler of its
  // own here, so running `todo` with no subcommand prints its help and fails
  // with a `ShowHelp` error.
  return todo.pipe(Command.withSubcommands([add, list]))
}

// Test versions of the platform services, as in the first example.
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
  const store = yield* Ref.make<ReadonlyArray<string>>([])
  const run = Command.runWith(makeApp(store), { version: '1.0.0' })

  // The first word picks the subcommand. The shared flag uses its default.
  yield* run(['add', 'Buy milk'])

  // The shared flag works before the subcommand name and after it.
  yield* run(['--list', 'work', 'add', 'Send invoice'])
  yield* run(['add', 'Book flights', '-l', 'work'])

  // Each subcommand still has its own flags, like `--all` on `list`.
  yield* run(['ls', '--list', 'work'])
  yield* run(['list', '--all'])
}).pipe(Effect.provide(CliTest))
