/**
 * @title Key-value storage
 * @difficulty beginner
 * @summary `KeyValueStore` is a small service for storing strings and bytes by
 * key. Code written against it runs unchanged on memory, the file system,
 * browser storage, or a SQL table, because only the layer changes.
 */

// The persistence modules live in `effect/persistence` and are marked
// unstable, so their API can still change in a minor release.
import { Console, Effect, Schema } from 'effect'
import { KeyValueStore } from 'effect/persistence'

class Settings extends Schema.Class<Settings>('Settings')({
  theme: Schema.Literals(['light', 'dark']),
  fontSize: Schema.Int,
}) {}

export const program = Effect.gen(function* () {
  const store = yield* KeyValueStore.KeyValueStore

  // The basic operations. A missing key reads as `undefined`.
  yield* store.set('greeting', 'hello')
  yield* Console.log(yield* store.get('greeting'))
  yield* Console.log(yield* store.get('missing'))

  // `modify` updates a value in place and returns the new one. It does
  // nothing when the key does not exist.
  yield* store.set('visits', '1')
  yield* store.modify('visits', (visits) => String(Number(visits) + 1))
  yield* Console.log(yield* store.get('visits'))

  // `prefix` gives a view in which every key gets a prefix, so separate
  // features can share one store without their keys colliding.
  const drafts = KeyValueStore.prefix(store, 'drafts:')
  yield* drafts.set('post-1', 'Effect by Example')
  yield* Console.log(
    yield* drafts.has('post-1'),
    yield* store.has('drafts:post-1'),
  )
  yield* Console.log(yield* store.size)

  // `toSchemaStore` stores structured values as JSON and decodes them on the
  // way out. Its `get` returns an `Option` of a validated `Settings`.
  const settings = KeyValueStore.toSchemaStore(store, Settings)
  yield* settings.set('user-1', new Settings({ theme: 'dark', fontSize: 14 }))
  yield* Console.log(yield* store.get('user-1'))
  yield* Console.log(yield* settings.get('user-1'))

  // A value that no longer matches the schema fails with a `SchemaError`
  // instead of reaching the program.
  yield* store.set('user-2', '{"theme":"sepia","fontSize":14}')
  const stale = yield* settings.get('user-2').pipe(Effect.flip)
  yield* Console.log(stale._tag)
}).pipe(
  // An in-memory store, for tests and examples. `layerFileSystem`,
  // `layerStorage` (for `localStorage`), and `layerSql` keep data across
  // restarts.
  Effect.provide(KeyValueStore.layerMemory),
)
