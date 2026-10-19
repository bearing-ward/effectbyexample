/**
 * @title Entry IDs and ordering
 * @difficulty advanced
 * @summary Every journal entry is identified by a UUIDv7, which starts with
 * the time it was written. Sorting entries by ID with
 * `EventJournal.EntryIdOrder` puts events from several devices into the order
 * they happened.
 */

import { Array as Arr, Console, DateTime, Effect, Order, Schema } from 'effect'
import { EventJournal } from 'effect/eventlog'

const at = (hour: number, minute: number) => Date.UTC(2026, 2, 14, hour, minute)

// `makeEntryIdUnsafe` creates an ID for the current time, or for `msecs`
// when given. The rest of the ID is random. It is "unsafe" only because it
// skips schema validation of the bytes. Here it backdates entries so the
// example has fixed times.
const entry = (time: number, event: string, primaryKey: string) =>
  new EventJournal.Entry({
    id: EventJournal.makeEntryIdUnsafe({ msecs: time }),
    event,
    primaryKey,
    payload: new Uint8Array(),
  })

export const program = Effect.gen(function* () {
  // Two devices recorded events while apart, each in its own order.
  const phone = [
    entry(at(9, 0), 'TodoAdded', 'todo-1'),
    entry(at(9, 30), 'TodoCompleted', 'todo-1'),
  ]
  const laptop = [
    entry(at(9, 10), 'TodoAdded', 'todo-2'),
    entry(at(9, 45), 'TodoRenamed', 'todo-2'),
  ]

  // `EntryIdOrder` compares the raw ID bytes. The time comes first in the
  // bytes, so this sorts by creation time. `Order.mapInput` lifts it from
  // IDs to entries. `EventJournal.Entry.Order` is the same order, ready made.
  const byId = Order.mapInput(
    EventJournal.EntryIdOrder,
    (entry: EventJournal.Entry) => entry.id,
  )
  const merged = Arr.sort([...laptop, ...phone], byId)
  yield* Console.log(
    merged.map(
      (entry) =>
        `${DateTime.formatIso(entry.createdAt).slice(11, 16)} ${entry.event} ${entry.primaryKey}`,
    ),
  )

  // The first 48 bits of the ID are the time in milliseconds, and the `7`
  // after them marks the UUID version. Two IDs from the same millisecond
  // differ only in their random part, so their order is arbitrary.
  yield* Console.log(merged.map((entry) => entry.idString.slice(0, 15)))

  // IDs are stored as 16 plain bytes, for example in a SQL BLOB column.
  // The `EntryId` schema checks that a value is a byte array and gives it
  // the branded type the journal APIs expect.
  const stored: unknown = Uint8Array.from(merged[0]!.id)
  const id = yield* Schema.decodeUnknownEffect(EventJournal.EntryId)(stored)
  yield* Console.log(
    `matches the original: ${EventJournal.EntryIdOrder(id, merged[0]!.id) === 0}`,
  )

  const notBytes = yield* Schema.decodeUnknownEffect(EventJournal.EntryId)(
    merged[0]!.idString,
  ).pipe(Effect.flip)
  yield* Console.log(`a UUID string is not an EntryId: ${notBytes._tag}`)
})
