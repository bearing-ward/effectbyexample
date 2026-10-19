/**
 * @title Live queries from events
 * @difficulty advanced
 * @summary `EventLog.groupReactivity` ties events to `Reactivity` keys. Every
 * write invalidates those keys, so any query that depends on them runs again
 * and a view built on it stays current without polling.
 */

import { Console, Effect, Layer, Queue, Ref, Schema } from 'effect'
import {
  EventGroup,
  EventJournal,
  EventLog,
  EventLogEncryption,
} from 'effect/eventlog'
import { Reactivity } from 'effect/reactivity'

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
const TodoLog = EventLog.schema(TodoEvents)

export const program = Effect.gen(function* () {
  const todos = yield* Ref.make(new Map<string, boolean>())

  const TodoHandlers = EventLog.group(TodoEvents, (handlers) =>
    handlers
      .handle('TodoAdded', ({ payload }) =>
        Ref.update(todos, (map) => new Map(map).set(payload.id, false)),
      )
      .handle('TodoCompleted', ({ payload }) =>
        Ref.update(todos, (map) => new Map(map).set(payload.id, true)),
      ),
  )

  // Map each event tag to the keys it makes stale. Adding a todo changes the
  // list and the open count; completing one changes only the open count. Pass
  // a plain array instead to use the same keys for every event in the group.
  const TodoReactivity = EventLog.groupReactivity(TodoEvents, {
    TodoAdded: ['todo-list', 'open-count'],
    TodoCompleted: ['open-count'],
  })

  // `EventLog.layer` takes one handler layer. To register more pieces, such
  // as reactivity keys, merge them and provide `EventLog.layerEventLog`,
  // which supplies the `Registry` they all register with.
  //
  // `layerEventLog` builds its own `Reactivity.layer`. Layers are shared by
  // reference within one build, so providing `Reactivity.layer` alongside it
  // gives this program the same instance the log invalidates.
  const TodoLogLive = Layer.mergeAll(TodoHandlers, TodoReactivity).pipe(
    Layer.provideMerge(EventLog.layerEventLog),
    Layer.provide(EventJournal.layerMemory),
    Layer.provide(
      Layer.effect(EventLog.Identity, EventLog.makeIdentity).pipe(
        Layer.provide(EventLogEncryption.layerSubtle),
      ),
    ),
    Layer.merge(Reactivity.layer),
  )

  yield* Effect.gen(function* () {
    const write = yield* EventLog.makeClient(TodoLog)

    // `Reactivity.query` runs an effect now and again after each
    // invalidation of its keys, offering every result to a queue. The keys
    // are what the log invalidates; it also invalidates `key:primaryKey`,
    // so a detail view can follow a single todo.
    const listRuns = yield* Ref.make(0)
    const list = yield* Reactivity.query(
      Ref.updateAndGet(listRuns, (n) => n + 1).pipe(
        Effect.andThen(Ref.get(todos)),
        Effect.map((map) => [...map.keys()].join(', ')),
      ),
      ['todo-list'],
    )
    const openCount = yield* Reactivity.query(
      Ref.get(todos).pipe(
        Effect.map((map) => [...map.values()].filter((done) => !done).length),
      ),
      ['open-count'],
    )
    yield* Console.log(`list: [${yield* Queue.take(list)}]`)
    yield* Console.log(`open: ${yield* Queue.take(openCount)}`)

    yield* write('TodoAdded', { id: 'todo-1', title: 'Buy milk' })
    yield* Console.log(`list: [${yield* Queue.take(list)}]`)
    yield* Console.log(`open: ${yield* Queue.take(openCount)}`)

    // Completing a todo only touches `open-count`, so the list query does
    // not run again.
    yield* write('TodoCompleted', { id: 'todo-1' })
    yield* Console.log(`open: ${yield* Queue.take(openCount)}`)
    yield* Console.log(`list query ran ${yield* Ref.get(listRuns)} times`)
  }).pipe(Effect.scoped, Effect.provide(TodoLogLive))
})
