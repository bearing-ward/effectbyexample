/**
 * @title Primitives and params
 * @difficulty advanced
 * @summary Under every flag and argument sit two small modules. A `Primitive`
 * turns one string into a typed value. A `Param` is the shared shape of flags
 * and arguments, so one combinator can work on both.
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
import {
  Argument,
  CliOutput,
  Command,
  Flag,
  Param,
  Primitive,
} from 'effect/cli'
import { ChildProcessSpawner } from 'effect/process'

// A `Param.withSchema` call is not tied to flags or arguments. This one
// checks that a number is a valid network port, and is reused twice below.
const asPort = Param.withSchema(
  Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 65535 })),
)

// `Primitive.Choice` maps fixed words to values. `Param.makeSingle` wraps it
// in a flag. This is how `Flag.Literals` and `Flag.ChoiceWithValue` are built.
const memory = Param.makeSingle({
  kind: Param.flagKind,
  name: 'memory',
  primitiveType: Primitive.Choice([
    ['small', 256],
    ['large', 1024],
  ]),
})

const run = Command.make(
  'run',
  {
    image: Argument.String('image'),
    // The same `asPort` validates a positional argument...
    port: Argument.Int('port').pipe(asPort),
    // ...and a repeatable flag. `atLeast(0)` collects every `--expose`.
    expose: Flag.Int('expose').pipe(asPort, Flag.atLeast(0)),
    // `KeyValuePair` parses repeated `--env KEY=VALUE` into a record.
    env: Flag.KeyValuePair('env').pipe(Flag.withDefault({})),
    memory: memory.pipe(Flag.withDefault(256)),
  },
  (input) => Console.log(input),
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
  CliOutput.layer({
    ...CliOutput.defaultFormatter({ colors: false }),
    formatHelpDoc: () => '(help omitted)',
  }),
)

export const program = Effect.gen(function* () {
  // A primitive is an Effect-returning parser. It fails with a plain string,
  // which the runner wraps into an `InvalidValue` error.
  yield* Console.log(yield* Primitive.Int.parse('8080'))
  yield* Console.log(yield* Effect.flip(Primitive.Int.parse('80.5')))
  yield* Console.log(yield* Primitive.Boolean.parse('yes'))

  const cli = Command.runWith(run, { version: '1.0.0', renderErrors: false })
  yield* cli([
    'postgres',
    '5432',
    '--expose',
    '9187',
    '--expose',
    '9090',
    '--env',
    'POSTGRES_USER=app',
    '--env',
    'TZ=UTC',
    '--memory',
    'large',
  ])

  // The port check applies in both places.
  for (const args of [
    ['redis', '70000'],
    ['redis', '6379', '--expose', '0'],
  ]) {
    yield* cli(args).pipe(
      Effect.catchTag('ShowHelp', (help) =>
        Effect.forEach(help.errors, (error) => Console.log(error.message)),
      ),
    )
  }
}).pipe(Effect.provide(services))
