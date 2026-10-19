/**
 * @title A journal in the browser
 * @difficulty advanced
 * @summary `EventJournal.makeIndexedDb` keeps the journal in the browser's
 * IndexedDB, so a local-first app keeps its events across page reloads. Where
 * IndexedDB does not exist, fall back to `makeMemory`.
 */

import { Console, Effect } from 'effect'
import { EventJournal } from 'effect/eventlog'

// The `make*` constructors return the journal service itself, which lets
// the program pick one at runtime. The `layer*` versions wrap the same
// constructors for the usual layer setup.
//
// `makeIndexedDb` opens the database when it runs, so it needs a `Scope`
// that closes the connection, and it fails with `EventJournalError` if the
// browser refuses. Outside a browser, `indexedDB` is not defined at all.
// Pressing Run on this page takes the IndexedDB branch. The recorded
// output comes from the memory branch in Node. Both print the same.
const openJournal =
  'indexedDB' in globalThis
    ? EventJournal.makeIndexedDb({ database: 'effect-by-example-notes' })
    : EventJournal.makeMemory

export const program = Effect.gen(function* () {
  const journal = yield* openJournal

  // Delete the database when the program ends, so each run starts empty.
  // A real app leaves it in place; that is the point of IndexedDB.
  yield* Effect.addFinalizer(() => Effect.ignore(journal.destroy))

  // The payload is the note's star rating, one byte. The event log would
  // store the schema-encoded payload here.
  yield* Effect.forEach(
    [
      { primaryKey: 'note-1', stars: 3 },
      { primaryKey: 'note-2', stars: 5 },
    ],
    ({ primaryKey, stars }) =>
      journal.write({
        event: 'NoteRated',
        primaryKey,
        payload: new Uint8Array([stars]),
        effect: () => Effect.void,
      }),
  )

  // Code that uses the journal does not know which storage is behind it.
  const entries = yield* journal.entries
  yield* Console.log(
    entries
      .map((entry) => `${entry.primaryKey}: ${entry.payload[0]} stars`)
      .toSorted(),
  )
}).pipe(Effect.scoped)
