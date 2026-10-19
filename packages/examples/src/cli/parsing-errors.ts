/**
 * @title Parsing errors
 * @difficulty intermediate
 * @summary When the words on the command line do not fit the command, the
 * runner does not call your handler. It prints help and fails with a typed
 * `CliError` that describes the problem, with suggestions for likely typos.
 */

import {
  Console,
  Effect,
  FileSystem,
  Layer,
  Path,
  Schema,
  Stdio,
  Terminal,
} from 'effect'
import { Argument, CliError, CliOutput, Command, Flag } from 'effect/cli'
import { ChildProcessSpawner } from 'effect/process'

class AccountLocked extends Schema.TaggedError<AccountLocked>()(
  'AccountLocked',
  { account: Schema.String },
) {}

// `withSchema` validates a parsed value with any Schema. Here the amount
// must be a positive integer, so `--amount 0` is rejected before the handler
// runs.
const transfer = Command.make(
  'transfer',
  {
    account: Argument.String('account'),
    amount: Flag.Int('amount').pipe(
      Flag.withSchema(Schema.Int.check(Schema.isGreaterThan(0))),
    ),
    currency: Flag.Literals('currency', ['EUR', 'USD']),
  },
  // Errors from the handler itself pass through unchanged, with their own
  // type. They are not `CliError`s.
  Effect.fn(function* ({ account, amount, currency }) {
    if (account === 'frozen') return yield* new AccountLocked({ account })
    yield* Console.log(`sent ${amount} ${currency} to ${account}`)
  }),
)

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
  // On a parse error the runner always prints the command's help. To keep
  // this page short, the formatter prints only the usage line of the help.
  CliOutput.layer({
    ...CliOutput.defaultFormatter({ colors: false }),
    formatHelpDoc: (doc) => `usage: ${doc.usage}`,
  }),
)

// `renderErrors: false` stops the runner from printing the errors, so the
// program can report them itself.
const run = (args: ReadonlyArray<string>) =>
  Command.runWith(transfer, { version: '1.0.0', renderErrors: false })(
    args,
  ).pipe(
    // Parse problems arrive as one `ShowHelp` error. Its `errors` field holds
    // the individual problems, each a tagged error from `CliError`.
    Effect.catchTag('ShowHelp', (help) =>
      Effect.forEach(help.errors, (error) =>
        Console.log(`  ${error._tag}: ${error.message}`),
      ),
    ),
    Effect.catchTag('AccountLocked', (error) =>
      Console.log(`  handler failed: ${error.account} is locked`),
    ),
  )

export const program = Effect.gen(function* () {
  yield* run(['alice', '--amount', '25', '--currency', 'EUR'])

  // Each misspelled flag gets a suggestion. Unknown flags are found before
  // any value is parsed, so all of them are reported together.
  yield* run(['alice', '--ammount', '25', '--curency', 'EUR'])

  // Values are checked against their type. Here both values are wrong, but
  // value parsing stops at the first problem, the amount.
  yield* run(['alice', '--amount', 'ten', '--currency', 'GBP'])

  // The Schema check rejects zero.
  yield* run(['alice', '--amount', '0', '--currency', 'USD'])

  // A missing argument and an extra one.
  yield* run(['--amount', '5', '--currency', 'USD'])
  yield* run(['alice', 'bob', '--amount', '5', '--currency', 'USD'])

  // Valid input reaches the handler, which can still fail in its own way.
  yield* run(['frozen', '--amount', '5', '--currency', 'USD'])

  // `CliError.isCliError` tells CLI errors apart from your own errors.
  const locked = new AccountLocked({ account: 'frozen' })
  const missing = new CliError.MissingOption({ option: 'amount' })
  yield* Console.log(CliError.isCliError(locked), CliError.isCliError(missing))
}).pipe(Effect.provide(CliTest))
