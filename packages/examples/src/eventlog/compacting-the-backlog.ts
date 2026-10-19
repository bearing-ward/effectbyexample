/**
 * @title Compacting the server backlog
 * @difficulty advanced
 * @summary A user who renamed their profile fifty times needs only the
 * latest name on a new device. When the unencrypted server replays its
 * backlog, `compactBacklog` hands runs of entries to the compactors
 * registered with `EventLog.groupCompaction` and sends what they write.
 */

import { Console, Effect, Layer, Schema, Stream } from 'effect'
import {
  EventGroup,
  EventJournal,
  EventLog,
  EventLogMessage,
  EventLogServerUnencrypted,
} from 'effect/eventlog'

const ProfileEvents = EventGroup.empty.add({
  tag: 'ProfileRenamed',
  primaryKey: (profile) => profile.userId,
  payload: Schema.Struct({ userId: Schema.String, name: Schema.String }),
})
const ProfileLog = EventLog.schema(ProfileEvents)
const storeId = EventLogMessage.StoreId.make('default')

// The server's handlers and compactor. The compactor gets the entries for
// one primary key at a time and writes the one that replaces them all.
const ServerEvents = Layer.mergeAll(
  EventLog.group(ProfileEvents, (handlers) =>
    handlers.handle('ProfileRenamed', () => Effect.void),
  ),
  EventLog.groupCompaction(ProfileEvents, ({ events, write }) => {
    const latest = events[events.length - 1]
    return latest === undefined
      ? Effect.void
      : write('ProfileRenamed', latest.payload)
  }),
).pipe(Layer.provideMerge(EventLog.layerRegistry))

// Entry payloads are binary; this reads a name back for printing.
const describe = (remote: EventJournal.RemoteEntry) => {
  const event = ProfileEvents.events[remote.entry.event]
  if (event === undefined) return Effect.succeed('?')
  return Schema.decodeUnknownEffect(event.payloadSchemaBinary)(
    remote.entry.payload,
  ).pipe(
    Effect.map(({ name }) => `#${remote.remoteSequence} ${name}`),
    Effect.orDie,
  )
}

const renameAndReplay = Effect.gen(function* () {
  // `makeStorageMemory` returns the in-memory storage as a value, and
  // `make` returns the `EventLogServerUnencrypted.EventLogServerUnencrypted`
  // service. `layerStorageMemory` and `layerServer` are these two wrapped in
  // layers. Here we hold them directly.
  const storage = yield* EventLogServerUnencrypted.makeStorageMemory
  const server = yield* EventLogServerUnencrypted.make.pipe(
    Effect.provideService(EventLogServerUnencrypted.Storage, storage),
  )
  const rename = server.makeWrite(ProfileLog)
  for (const [userId, name] of [
    ['user-1', 'Ada'],
    ['user-2', 'Grace'],
    ['user-1', 'Ada L.'],
    ['user-1', 'Ada Lovelace'],
  ] as const) {
    yield* rename({
      storeId,
      event: 'ProfileRenamed',
      payload: { userId, name },
    })
  }

  // Storage keeps all four entries. Reading with no compactors shows them.
  const stored = yield* storage
    .changes({ storeId, startSequence: 0, compactors: new Map() })
    .pipe(Stream.take(4), Stream.runCollect)
  yield* Console.log('stored:', yield* Effect.forEach(stored, describe))

  // `compactBacklog` runs the registry's compactors over them: one entry per
  // user remains. Each keeps a sequence number from the run it replaced, and
  // the last one keeps the highest, so a device resumes after all four.
  const registry = yield* EventLog.Registry
  const compacted = yield* EventLogServerUnencrypted.compactBacklog({
    remoteEntries: stored,
    compactors: registry.compactors,
  })
  yield* Console.log('compacted:', yield* Effect.forEach(compacted, describe))

  // The storage's `changes` does the same to its backlog when given the
  // compactors, which is what a syncing device receives. Entries written
  // after the device subscribed arrive one by one, uncompacted.
  const replay = yield* storage
    .changes({ storeId, startSequence: 0, compactors: registry.compactors })
    .pipe(Stream.take(2), Stream.runCollect)
  yield* Console.log('replayed:', yield* Effect.forEach(replay, describe))
})

export const program = renameAndReplay.pipe(
  Effect.provide(ServerEvents),
  Effect.scoped,
)
