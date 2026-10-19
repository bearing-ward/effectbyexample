/**
 * @title Defining events
 * @difficulty intermediate
 * @summary An event log records what happened as a list of typed events, and
 * derives current state from that list. Declare events with schemas, handle
 * each one, and write them through the log.
 */

// The event log lives in `effect/eventlog`. The module is marked unstable,
// so its API can still change in a minor release.
import { Console, Effect, Layer, Ref, Schema } from 'effect'
import {
  EventGroup,
  EventJournal,
  EventLog,
  EventLogEncryption,
} from 'effect/eventlog'

// An `EventGroup` declares related events. Each event has a tag, a payload
// schema, and a primary key that names the thing it is about. Here every
// event is about one todo.
const TodoEvents = EventGroup.empty
  .add({
    tag: 'TodoAdded',
    primaryKey: (todo) => todo.id,
    payload: Schema.Struct({ id: Schema.String, title: Schema.String }),
  })
  .add({
    tag: 'TodoCompleted',
    primaryKey: (todo) => todo.id,
    payload: Schema.Struct({ id: Schema.String }),
  })

// The schema collects every group the log understands.
const TodoLog = EventLog.schema(TodoEvents)

export const program = Effect.gen(function* () {
  // The current state, rebuilt from events. Real applications usually keep
  // this in a database table or in UI state.
  const todos = yield* Ref.make(new Map<string, string>())

  // `EventLog.group` registers a handler for every event in the group. Leave
  // one out and the code does not compile.
  const TodoHandlers = EventLog.group(TodoEvents, (handlers) =>
    handlers
      .handle('TodoAdded', ({ payload }) =>
        Ref.update(todos, (map) =>
          new Map(map).set(payload.id, `[ ] ${payload.title}`),
        ),
      )
      .handle('TodoCompleted', ({ payload }) =>
        Ref.update(todos, (map) => {
          const title = map.get(payload.id)?.slice(4) ?? payload.id
          return new Map(map).set(payload.id, `[x] ${title}`)
        }),
      ),
  )

  // Wire the log together. The journal stores entries, here in memory; it
  // also comes as IndexedDB and SQL layers. The identity names this user and
  // is used to encrypt entries when syncing.
  const TodoLogLive = EventLog.layer(TodoLog, TodoHandlers).pipe(
    Layer.provide(EventLog.layerRegistry),
    Layer.provide(EventJournal.layerMemory),
    Layer.provide(
      Layer.effect(EventLog.Identity, EventLog.makeIdentity).pipe(
        Layer.provide(EventLogEncryption.layerSubtle),
      ),
    ),
  )

  yield* Effect.gen(function* () {
    // `makeClient` returns a typed function for writing events. The tag and
    // payload are checked against the schema.
    const write = yield* EventLog.makeClient(TodoLog)
    yield* write('TodoAdded', { id: 'todo-1', title: 'Read about event logs' })
    yield* write('TodoAdded', { id: 'todo-2', title: 'Write an example' })
    yield* write('TodoCompleted', { id: 'todo-1' })

    yield* Console.log([...(yield* Ref.get(todos)).values()])

    // The journal holds every event, in order. State can always be rebuilt
    // by running the handlers over these entries again.
    const log = yield* EventLog.EventLog
    const entries = yield* log.entries
    yield* Console.log(
      entries.map((entry) => `${entry.event} ${entry.primaryKey}`),
    )
  }).pipe(Effect.provide(TodoLogLive))
})
