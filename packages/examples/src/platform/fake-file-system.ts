/**
 * @title Faking the file system
 * @difficulty intermediate
 * @summary Code that reads files through the `FileSystem` service can be
 * tested without a disk. `FileSystem.layerNoop` builds a file system from
 * only the operations you supply, and `PlatformError` values let the fake
 * fail the same way a real one would.
 */

import {
  Console,
  Effect,
  FileSystem,
  Path,
  PlatformError,
  Schema,
} from 'effect'

class AppConfig extends Schema.Class<AppConfig>('AppConfig')({
  port: Schema.Int,
  logLevel: Schema.String,
}) {}

// The code under test: read `config/app.json`, or fall back to defaults when
// the file does not exist. Any other failure, such as a permission
// problem, still reaches the caller.
const loadConfig = (root: string) =>
  Effect.gen(function* () {
    const fs = yield* FileSystem.FileSystem
    const path = yield* Path.Path
    const text = yield* fs.readFileString(path.join(root, 'config', 'app.json'))
    return yield* Schema.decodeEffect(Schema.fromJsonString(AppConfig))(text)
  }).pipe(
    Effect.catchReason('PlatformError', 'NotFound', () =>
      Effect.succeed(new AppConfig({ port: 8080, logLevel: 'info' })),
    ),
  )

// A fake file system backed by a map. Only `readFileString` is
// implemented. `layerNoop` makes the other operations fail with `NotFound`,
// except `exists`, which answers `false`.
const fakeFiles = (files: Record<string, string>) =>
  FileSystem.layerNoop({
    readFileString: (file) => {
      const content = files[file]
      if (content !== undefined) return Effect.succeed(content)
      // A real file system reports a missing file as a `PlatformError`
      // with a `NotFound` reason. The fake builds the same value.
      return Effect.fail(
        PlatformError.systemError({
          _tag: 'NotFound',
          module: 'FileSystem',
          method: 'readFileString',
          pathOrDescriptor: file,
        }),
      )
    },
  })

// A file system where everything is off limits.
const lockedDown = FileSystem.layerNoop({
  readFileString: (file) =>
    Effect.fail(
      PlatformError.systemError({
        _tag: 'PermissionDenied',
        module: 'FileSystem',
        method: 'readFileString',
        pathOrDescriptor: file,
      }),
    ),
})

export const program = Effect.gen(function* () {
  // The file exists.
  const fromFile = yield* loadConfig('/srv/app').pipe(
    Effect.provide(
      fakeFiles({
        '/srv/app/config/app.json': '{"port":3000,"logLevel":"debug"}',
      }),
    ),
  )
  yield* Console.log(fromFile)

  // The file is missing, so the defaults apply.
  const defaults = yield* loadConfig('/srv/app').pipe(
    Effect.provide(fakeFiles({})),
  )
  yield* Console.log(defaults)

  // Permission denied is not handled by `loadConfig`, so it fails. The
  // error's message names the operation and the path.
  const denied = yield* loadConfig('/srv/app').pipe(
    Effect.provide(lockedDown),
    Effect.flip,
  )
  if (PlatformError.isPlatformError(denied)) {
    yield* Console.log(denied.reason._tag, denied.message)
  }

  // Operations the fake does not implement fail with `NotFound`.
  const fs = yield* FileSystem.FileSystem.pipe(Effect.provide(fakeFiles({})))
  const listing = yield* fs.readDirectory('/srv/app').pipe(Effect.flip)
  yield* Console.log(listing.reason._tag, yield* fs.exists('/srv/app'))
}).pipe(
  // `Path.layer` is a POSIX path implementation that runs anywhere.
  Effect.provide(Path.layer),
)
