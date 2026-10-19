/**
 * @title Child processes
 * @difficulty intermediate
 * @summary A `ChildProcess` command is a plain description of what to run.
 * The `ChildProcessSpawner` service runs it, collects or streams its output,
 * and kills it when the surrounding scope closes.
 */

// Commands live in `effect/process`, which is marked unstable. The spawner
// for Node comes from `NodeServices.layer`.
import { NodeServices } from '@effect/platform-node'
import { Console, Effect, Stream, String } from 'effect'
import { ChildProcess, ChildProcessSpawner } from 'effect/process'

export const program = Effect.gen(function* () {
  const spawner = yield* ChildProcessSpawner.ChildProcessSpawner

  // Building a command runs nothing. Arguments are passed as a list, not
  // through a shell, so they need no quoting.
  const greet = ChildProcess.make('echo', ['hello', 'from a child process'])
  yield* Console.log(greet.command, greet.args)

  // `string` runs the command and collects standard output.
  const output = yield* spawner.string(greet)
  yield* Console.log(String.trim(output))

  // `lines` splits the output into lines. Input can come from a `Stream`,
  // which is piped into the child's standard input.
  const sorted = yield* spawner.lines(
    ChildProcess.make('sort', [], {
      stdin: Stream.make('pears\n', 'apples\n', 'figs\n').pipe(
        Stream.encodeText,
      ),
    }),
  )
  yield* Console.log(sorted)

  // `pipeTo` connects one command's output to the next one's input, like
  // `|` in a shell.
  const shout = ChildProcess.make('printf', ['quiet words']).pipe(
    ChildProcess.pipeTo(ChildProcess.make('tr', ['a-z', 'A-Z'])),
  )
  yield* Console.log(yield* spawner.string(shout))

  // Collecting output does not check the exit code. Ask for it with
  // `exitCode` when it matters.
  const code = yield* spawner.exitCode(
    ChildProcess.make('sh', ['-c', 'exit 3']),
  )
  yield* Console.log(`exit code ${code}`)

  // `spawn` returns a handle to a running process, so you can read its
  // output while it runs. The process belongs to the scope and is killed if
  // the scope closes first.
  const firstTwo = yield* Effect.gen(function* () {
    const handle = yield* spawner.spawn(
      ChildProcess.make('sh', [
        '-c',
        'for i in 1 2 3; do echo "tick $i"; sleep 0.05; done',
      ]),
    )
    return yield* handle.stdout.pipe(
      Stream.decodeText,
      Stream.splitLines,
      Stream.take(2),
      Stream.runCollect,
    )
  }).pipe(Effect.scoped)
  yield* Console.log(firstTwo)

  // A program that does not exist fails with a `PlatformError`.
  const missing = yield* spawner
    .string(ChildProcess.make('definitely-not-installed', []))
    .pipe(Effect.flip)
  yield* Console.log(missing._tag, missing.reason._tag)
}).pipe(Effect.provide(NodeServices.layer))
