/**
 * @title Files and paths
 * @difficulty beginner
 * @summary `FileSystem` and `Path` are services, so the same code runs on
 * Node, Bun, or an in-memory fake in tests. Every operation is an Effect that
 * fails with a typed `PlatformError`.
 */

// The interfaces live in `effect`. The implementations come from a platform
// package, here `@effect/platform-node`.
import { NodeServices } from '@effect/platform-node'
import { Console, Effect, FileSystem, Path } from 'effect'

export const program = Effect.gen(function* () {
  // Ask for the services you need. Nothing here mentions Node.
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path

  // A scoped temporary directory is deleted when the scope closes, even if
  // the program fails halfway through.
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'notes-' })
  const notes = path.join(directory, 'notes')
  yield* fs.makeDirectory(notes, { recursive: true })

  yield* fs.writeFileString(
    path.join(notes, 'today.md'),
    '# Today\n- learn Effect\n',
  )
  yield* fs.writeFileString(path.join(notes, 'later.md'), '# Later\n')

  const files = yield* fs.readDirectory(notes)
  yield* Console.log([...files].sort())

  const today = yield* fs.readFileString(path.join(notes, 'today.md'))
  yield* Console.log(today.trim())

  // `Path` handles separators and extensions portably.
  yield* Console.log(
    path.extname('today.md'),
    path.basename('/a/b/today.md', '.md'),
  )

  // Failures are values: a missing file is a `PlatformError` you can match.
  const missing = yield* fs.readFileString(path.join(notes, 'missing.md')).pipe(
    Effect.as('found'),
    Effect.catchTag('PlatformError', (error) =>
      Effect.succeed(`${error.reason._tag}: could not read missing.md`),
    ),
  )
  yield* Console.log(missing)
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
