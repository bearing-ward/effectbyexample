/**
 * @title Encrypting entries by hand
 * @difficulty advanced
 * @summary `EventLogEncryption` is the service the encrypted remote uses to
 * seal entries before they leave a device and open the ones that come back.
 * Calling it directly shows what a server stores and what it cannot read.
 */

// `makeEncryptionSubtle` builds the service from any Web Crypto
// implementation. `layerSubtle` uses `globalThis.crypto`; on a server you can
// pass Node's `webcrypto` instead, as here. This file runs only on a server.
import { webcrypto } from 'node:crypto'
import { Cause, Console, Effect, Exit, Layer } from 'effect'
import {
  EventJournal,
  EventLog,
  EventLogEncryption,
  EventLogMessage,
} from 'effect/eventlog'

const EncryptionLive = Layer.effect(
  EventLogEncryption.EventLogEncryption,
  EventLogEncryption.makeEncryptionSubtle(webcrypto as Crypto),
)

const text = new TextEncoder()
const contains = (bytes: Uint8Array, needle: string) =>
  new TextDecoder().decode(bytes).includes(needle)

export const program = Effect.gen(function* () {
  const encryption = yield* EventLogEncryption.EventLogEncryption
  const identity = yield* EventLog.makeIdentity
  const entry = new EventJournal.Entry({
    id: EventJournal.makeEntryIdUnsafe(),
    event: 'NoteWritten',
    primaryKey: 'note-1',
    payload: text.encode('door code is 4711'),
  })

  // `encrypt` seals each entry with AES-GCM, under a key derived from the
  // identity's private key. Every entry gets a fresh 12-byte IV. The
  // ciphertext is the encoded entry plus a 16-byte authentication tag.
  const [plain] = yield* EventJournal.Entry.encodeArray([entry])
  const [sealed] = yield* encryption.encrypt(identity, [entry])
  if (plain === undefined || sealed === undefined) return
  yield* Console.log('iv', sealed.iv.length, 'bytes')
  yield* Console.log('overhead', sealed.encryptedEntry.length - plain.length)

  // An `EncryptedEntry` pairs that ciphertext with the entry's id, which
  // stays readable so the server can tell entries apart. This is what
  // `WriteEntries` carries to the server, and all the server ever decodes.
  const outgoing = EventLogEncryption.EncryptedEntry.make({
    entryId: entry.id,
    iv: sealed.iv,
    encryptedEntry: sealed.encryptedEntry,
  })
  const bytes = yield* new EventLogMessage.WriteEntries({
    publicKey: identity.publicKey,
    storeId: EventLogMessage.StoreId.make('default'),
    encryptedEntries: [outgoing],
  }).encoded
  yield* Console.log('note visible on the wire:', contains(bytes, '4711'))

  // The server stores it and assigns a sequence number. What it sends back
  // in `Changes` is an `EncryptedRemoteEntry`.
  const stored = EventLogEncryption.EncryptedRemoteEntry.make({
    sequence: 1,
    ...outgoing,
  })

  // `decrypt` opens it again on any device with the same identity and
  // returns a `RemoteEntry`: the original entry plus the server's sequence.
  const [opened] = yield* encryption.decrypt(identity, [stored])
  yield* Console.log(
    opened?.remoteSequence,
    opened?.entry.idString === entry.idString,
    new TextDecoder().decode(opened?.entry.payload),
  )

  // A different identity derives a different key. AES-GCM checks the tag,
  // so decryption fails rather than returning garbage. The service reports
  // this as a defect, not a typed error, so `Effect.exit` is how to see it.
  const stranger = yield* EventLog.makeIdentity
  const exit = yield* Effect.exit(encryption.decrypt(stranger, [stored]))
  yield* Console.log(
    'stranger fails with a defect:',
    Exit.isFailure(exit) && Cause.hasDies(exit.cause),
  )
}).pipe(Effect.provide(EncryptionLive))
