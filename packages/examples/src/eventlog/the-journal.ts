/**
 * @title The journal
 * @difficulty advanced
 * @summary Under the event log sits the journal: the storage for raw entries.
 * Each entry has a timestamped ID, the event tag, the primary key, and the
 * payload as encoded bytes. Swap the journal layer to change where events live.
 */

import { Console, Effect } from 'effect'
import { EventJournal } from 'effect/eventlog'

export const program = Effect.gen(function* () {
  const journal = yield* EventJournal.EventJournal

  // `write` stores one entry. The payload is bytes: the event log encodes
  // payloads with their schema before they reach the journal. `effect` runs
  // inside the write, and the entry only commits if it succeeds. That is how
  // the event log runs handlers.
  const updates = [
    { primaryKey: 'user-1', byte: 1 },
    { primaryKey: 'user-2', byte: 2 },
    { primaryKey: 'user-1', byte: 3 },
  ]
  yield* Effect.forEach(updates, ({ primaryKey, byte }) =>
    journal.write({
      event: 'ProfileUpdated',
      primaryKey,
      payload: new Uint8Array([byte]),
      effect: (entry) =>
        Console.log(`committing ${entry.event} for ${entry.primaryKey}`),
    }),
  )

  const entries = yield* journal.entries
  yield* Console.log(`${entries.length} entries`)

  // `entries` returns entries in the order they were written.
  yield* Console.log(
    entries.map((entry) => `${entry.primaryKey}: ${entry.payload[0]}`),
  )

  // Entry IDs are UUIDv7, which begin with their creation time. The journal
  // reads the timestamp back out of the ID rather than storing it separately.
  // IDs from the same millisecond are not ordered, so rely on journal order
  // rather than sorting IDs.
  const [first] = entries
  yield* Console.log(
    `id holds the time: ${first!.createdAtMillis === EventJournal.entryIdMillis(first!.id)}`,
  )

  // Changing storage is a one-line change: `EventJournal.layerIndexedDb()`
  // in a browser, or `SqlEventJournal.layer` with an Effect SQL client on a
  // server.
}).pipe(Effect.provide(EventJournal.layerMemory))
