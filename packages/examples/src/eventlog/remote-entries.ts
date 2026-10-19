/**
 * @title Moving entries between journals
 * @difficulty advanced
 * @summary Syncing comes down to three journal operations: collect the entries
 * a remote has not seen, send them as bytes, and import them on the other side
 * as `RemoteEntry` values. The journal remembers what it sent and received, so
 * nothing is applied twice.
 */

import { Console, Effect, Option, Schema } from 'effect'
import { EventJournal } from 'effect/eventlog'

export const program = Effect.gen(function* () {
  // `makeMemory` returns a journal service directly instead of a layer.
  // Each call is a separate journal, so one program can hold two devices.
  const laptop = yield* EventJournal.makeMemory
  const phone = yield* EventJournal.makeMemory

  // Each side names the other with a `RemoteId`: 16 bytes, usually a UUID
  // kept in settings. The schema checks saved bytes and brands them.
  const decodeRemoteId = Schema.decodeUnknownSync(EventJournal.RemoteId)
  const laptopId = decodeRemoteId(new Uint8Array(16).fill(1))
  const phoneId = decodeRemoteId(new Uint8Array(16).fill(2))

  yield* Effect.forEach(['todo-1', 'todo-2'], (primaryKey, i) =>
    laptop.write({
      event: 'TodoAdded',
      primaryKey,
      payload: new Uint8Array([i]),
      effect: () => Effect.void,
    }),
  )

  // `withRemoteUncommited` passes the entries the phone has not received
  // yet, and marks them as sent once the effect succeeds. `Entry.encodeArray`
  // turns them into bytes for the wire.
  const send = laptop.withRemoteUncommited(phoneId, (entries) =>
    EventJournal.Entry.encodeArray(entries),
  )
  const batch = yield* send
  yield* Console.log(`sent ${Option.getOrThrow(batch).length} entries`)

  // The phone decodes the batch and numbers each entry by its position in
  // the laptop's stream. That makes it a `RemoteEntry`.
  const decoded = yield* EventJournal.Entry.decodeArray(
    Option.getOrThrow(batch),
  )
  const start = yield* phone.nextRemoteSequence(laptopId)
  const incoming = decoded.map(
    (entry, i) =>
      new EventJournal.RemoteEntry({ remoteSequence: start + i, entry }),
  )

  const receive = phone.writeFromRemote({
    remoteId: laptopId,
    entries: incoming,
    // `effect` runs for each new entry before it is stored. The event log
    // runs handlers here. `conflicts` lists entries this journal already
    // has for the same event and key that were written later.
    effect: ({ entry, conflicts }) =>
      Console.log(
        `phone applies ${entry.event} ${entry.primaryKey} (${conflicts.length} conflicts)`,
      ),
  })
  yield* receive

  // The phone tracks the next sequence it expects from the laptop. After a
  // restart, it asks the laptop for changes from this position on.
  yield* Console.log(`resume at: ${yield* phone.nextRemoteSequence(laptopId)}`)

  // Asking the laptop again finds nothing new for the phone.
  const next = yield* send
  yield* Console.log(
    `second send: ${Option.isNone(next) ? 'nothing new' : 'more'}`,
  )

  // Delivering the same batch twice is safe. Known entries come back as
  // duplicates and their effect does not run.
  const again = yield* receive
  yield* Console.log(`redelivered: ${again.duplicateEntries.length} duplicates`)
  yield* Console.log(`phone holds: ${(yield* phone.entries).length} entries`)
})
