/**
 * @title Keeping an identity across restarts
 * @difficulty intermediate
 * @summary The event log's `Identity` decides which entries a device can read
 * and decrypt when it syncs. Generate it once, save it as a string, and load
 * the same identity every time the app starts.
 */

import { Console, Effect, Layer, Redacted, Schema } from 'effect'
import { EventLog, EventLogEncryption } from 'effect/eventlog'
import { KeyValueStore } from 'effect/persistence'

// `encodeIdentityString` packs the public key and the private key bytes into
// one base64url string, ready for local storage. `decodeIdentityString`
// reverses it, and throws if the string is not a valid identity.
const loadIdentity = Effect.gen(function* () {
  const store = yield* KeyValueStore.KeyValueStore
  const saved = yield* store.get('identity')
  if (saved !== undefined) {
    yield* Console.log('loaded the saved identity')
    return EventLog.decodeIdentityString(saved)
  }
  const identity = yield* EventLog.makeIdentity
  yield* store.set('identity', EventLog.encodeIdentityString(identity))
  yield* Console.log('created and saved a new identity')
  return identity
})

// Use the loader as the `Identity` layer in place of a bare `makeIdentity`.
const IdentityLive = Layer.effect(EventLog.Identity, loadIdentity).pipe(
  Layer.provide(EventLogEncryption.layerSubtle),
)

export const program = Effect.gen(function* () {
  // Each `Effect.provide` builds the layer afresh, like an app launch.
  const launch = Effect.gen(function* () {
    return yield* EventLog.Identity
  }).pipe(Effect.provide(IdentityLive))
  const first = yield* launch
  const second = yield* launch

  const sameKey =
    Redacted.value(first.privateKey).join() ===
    Redacted.value(second.privateKey).join()
  yield* Console.log(
    `same identity: ${first.publicKey === second.publicKey && sameKey}`,
  )

  // `IdentitySchema` is the identity as a schema, for when it travels inside
  // other data, such as a JSON export a user moves to a new device. Encoding
  // gives the private key as base64. Decoding wraps it in `Redacted`, so it
  // does not leak into logs.
  const exported = yield* Schema.encodeEffect(EventLog.IdentitySchema)(first)
  yield* Console.log(`exported private key: ${typeof exported.privateKey}`)
  const imported = yield* Schema.decodeUnknownEffect(EventLog.IdentitySchema)(
    exported,
  )
  yield* Console.log(`private key: ${imported.privateKey}`)

  // Anything else is rejected before it can become an identity.
  const bad = yield* Schema.decodeUnknownEffect(EventLog.IdentitySchema)({
    publicKey: 'user-1',
  }).pipe(Effect.flip)
  yield* Console.log(`missing private key: ${bad._tag}`)
}).pipe(
  // In a browser, `KeyValueStore.layerStorage(() => localStorage)` keeps the
  // string in local storage. The memory store lasts for this program.
  Effect.provide(KeyValueStore.layerMemory),
)
