/**
 * @title Compacting events on sync
 * @difficulty advanced
 * @summary A device that was offline can come back to hundreds of events from
 * other devices. `EventLog.groupCompaction` folds the incoming events for each
 * primary key into fewer events before the handlers run, so the device skips
 * the intermediate states.
 */

import { Console, Effect, Layer, Queue, Ref, Schedule, Schema } from 'effect'
import { SchemaBinary } from 'effect/encoding'
import {
  EventGroup,
  EventJournal,
  EventLog,
  EventLogEncryption,
  type EventLogRemote,
} from 'effect/eventlog'

const Todo = Schema.Struct({ id: Schema.String, title: Schema.String })
const TodoEvents = EventGroup.empty
  .add({ tag: 'TodoAdded', primaryKey: (todo) => todo.id, payload: Todo })
  .add({ tag: 'TodoRenamed', primaryKey: (todo) => todo.id, payload: Todo })

// Entries as another device, a laptop, would send them: the payload in the
// binary form events use (`SchemaBinary.toCodec` of the payload schema), an
// ID that carries the time it was written, and the position in the laptop's
// stream.
const encodeTodo = Schema.encodeEffect(SchemaBinary.toCodec(Todo))
const fromLaptop = (
  remoteSequence: number,
  minute: number,
  event: 'TodoAdded' | 'TodoRenamed',
  todo: typeof Todo.Type,
) =>
  encodeTodo(todo).pipe(
    Effect.map(
      (payload) =>
        new EventJournal.RemoteEntry({
          remoteSequence,
          entry: new EventJournal.Entry({
            id: EventJournal.makeEntryIdUnsafe({ msecs: minute * 60_000 }),
            event,
            primaryKey: todo.id,
            payload,
          }),
        }),
    ),
  )

export const program = Effect.gen(function* () {
  const applied = yield* Ref.make(0)
  const TodoHandlers = EventLog.group(TodoEvents, (handlers) =>
    handlers
      .handle('TodoAdded', ({ payload }) =>
        Ref.update(applied, (n) => n + 1).pipe(
          Effect.andThen(Console.log(`added ${payload.id}: ${payload.title}`)),
        ),
      )
      .handle('TodoRenamed', ({ payload }) =>
        Ref.update(applied, (n) => n + 1).pipe(
          Effect.andThen(
            Console.log(`renamed ${payload.id}: ${payload.title}`),
          ),
        ),
      ),
  )

  // The compactor gets the incoming events for one primary key, in order,
  // and writes their replacement. A todo that was added and then renamed
  // becomes a single `TodoAdded` with the final title.
  const TodoCompaction = EventLog.groupCompaction(
    TodoEvents,
    ({ primaryKey, events, write }) =>
      Effect.gen(function* () {
        yield* Console.log(`${primaryKey}: ${events.length} in, 1 out`)
        const title = events[events.length - 1]!.payload.title
        const wasAdded = events.some((event) => event._tag === 'TodoAdded')
        yield* write(wasAdded ? 'TodoAdded' : 'TodoRenamed', {
          id: primaryKey,
          title,
        })
      }),
  )

  const TodoLogLive = Layer.mergeAll(TodoHandlers, TodoCompaction).pipe(
    Layer.provideMerge(EventLog.layerEventLog),
    Layer.provide(EventJournal.layerMemory),
    Layer.provide(
      Layer.effect(EventLog.Identity, EventLog.makeIdentity).pipe(
        Layer.provide(EventLogEncryption.layerSubtle),
      ),
    ),
  )

  yield* Effect.gen(function* () {
    // While the phone was offline, the laptop renamed one todo twice and
    // added another.
    const inbox = yield* Queue.unbounded<EventJournal.RemoteEntry>()
    yield* Queue.offerAll(
      inbox,
      yield* Effect.all([
        fromLaptop(0, 1, 'TodoAdded', { id: 'todo-1', title: 'Buy milk' }),
        fromLaptop(1, 2, 'TodoRenamed', {
          id: 'todo-1',
          title: 'Buy oat milk',
        }),
        fromLaptop(2, 3, 'TodoAdded', { id: 'todo-2', title: 'Call Sam' }),
        fromLaptop(3, 4, 'TodoRenamed', {
          id: 'todo-1',
          title: 'Buy 2L oat milk',
        }),
      ]),
    )

    // Compaction only runs on entries that arrive from a remote. A real
    // remote, such as `EventLogRemote.layerUnencrypted`, registers itself
    // with the `Registry`. This stand-in serves the inbox and accepts every
    // write.
    const remote: EventLogRemote.EventLogRemote['Service'] = {
      id: EventJournal.makeRemoteIdUnsafe(),
      changes: () => Effect.succeed(inbox),
      write: () => Effect.void,
      whenAuthenticated: (effect) => effect,
    }
    const registry = yield* EventLog.Registry
    yield* registry.registerRemote(remote)

    // The journal commits the batch after the handlers run, so waiting for
    // all four entries also waits for the handlers.
    const log = yield* EventLog.EventLog
    const entries = yield* log.entries.pipe(
      Effect.repeat({
        until: (entries) => entries.length === 4,
        schedule: Schedule.spaced('1 millis'),
      }),
    )

    // Four events arrived and the handlers ran twice. The journal still
    // keeps all four, so the full history is there for later replays and
    // for syncing on to other devices.
    yield* Console.log(
      `journal entries: ${entries.length}, handler runs: ${yield* Ref.get(applied)}`,
    )
  }).pipe(Effect.scoped, Effect.provide(TodoLogLive))
})
