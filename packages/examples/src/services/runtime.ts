/**
 * @title Exit codes with Runtime
 * @difficulty advanced
 * @summary The `Runtime` module is the toolkit behind `NodeRuntime.runMain`
 * and `BunRuntime.runMain`: it turns how a main program ended into a process
 * exit code. You rarely build a runner yourself, but the same rules decide
 * your app's exit code, and you can tune them.
 */

import { Console, Effect, Exit, Runtime, Schema } from 'effect'

// An error can carry its own exit code under the `Runtime.errorExitCode`
// key. Without one, a failure exits with 1.
class MigrationFailed extends Schema.TaggedError<MigrationFailed>()(
  'MigrationFailed',
  { table: Schema.String },
) {
  readonly [Runtime.errorExitCode] = 3
}

// `makeRunMain` builds a runner for a host. It forks the program and hands
// us the fiber and a `teardown` function. Our host waits for the fiber to
// finish and lets teardown pick the code. A real host would call
// `process.exit(code)`; this one reports the code back to the caller.
const runMain = (
  main: Effect.Effect<unknown, unknown>,
  teardown: Runtime.Teardown = Runtime.defaultTeardown,
) =>
  Effect.callback<number>((resume) => {
    const run = Runtime.makeRunMain(({ fiber, teardown: finish }) => {
      fiber.addObserver((exit) =>
        finish(exit, (code) => resume(Effect.succeed(code))),
      )
    })
    // Error reporting would log the failure to the real console, which is
    // what you want in an app but not on this page.
    run(main, { teardown, disableErrorReporting: true })
  })

export const program = Effect.gen(function* () {
  // `defaultTeardown` exits with 0 on success.
  yield* Console.log('success:', yield* runMain(Effect.succeed('migrated')))

  // A plain failure exits with 1.
  yield* Console.log('failure:', yield* runMain(Effect.fail('disk full')))

  // An error with `errorExitCode` sets its own code.
  yield* Console.log(
    'migration failed:',
    yield* runMain(new MigrationFailed({ table: 'orders' })),
  )

  // Interruption, such as Ctrl-C, exits with 130 like other Unix tools.
  yield* Console.log('interrupted:', yield* runMain(Effect.interrupt))

  // A custom teardown can change the policy, for example treating
  // interruption as a clean shutdown for a long-running worker.
  const worker: Runtime.Teardown = (exit, onExit) =>
    Exit.hasInterrupts(exit) ? onExit(0) : Runtime.defaultTeardown(exit, onExit)
  yield* Console.log(
    'interrupted worker:',
    yield* runMain(Effect.interrupt, worker),
  )
})
