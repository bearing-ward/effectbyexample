/**
 * @title Syncing devices
 * @difficulty advanced
 * @summary The event log is built for local-first apps. Each device writes to
 * its own journal and works offline. A remote server relays entries between
 * devices, and each device replays the others' events through its handlers.
 */

import { Console, Context, Effect, Layer, Ref, Schedule, Schema } from 'effect'
import {
  EventGroup,
  EventJournal,
  EventLog,
  EventLogEncryption,
  EventLogMessage,
  EventLogRemote,
  EventLogServerUnencrypted,
} from 'effect/eventlog'
import { RpcTest } from 'effect/rpc'

const TodoEvents = EventGroup.empty.add({
  tag: 'TodoAdded',
  primaryKey: (todo) => todo.id,
  payload: Schema.Struct({ id: Schema.String, title: Schema.String }),
})
const TodoLog = EventLog.schema(TodoEvents)

// The server stores entries and serves them to every device of the same
// identity. Storage is in memory here; `SqlEventLogServerUnencrypted` stores
// them in a database. The authorization service decides who may read and
// write; this one allows everything. Devices write to the store named by
// `EventLog.CurrentStoreId`, "default" unless you change it, and the store
// mapping must agree. If the names differ, nothing syncs and nothing fails.
const ServerLive = EventLogServerUnencrypted.layerNoRpcServer(
  TodoLog,
  EventLog.group(TodoEvents, (handlers) =>
    handlers.handle('TodoAdded', () => Effect.void),
  ),
).pipe(
  Layer.provide(EventLogServerUnencrypted.layerStorageMemory),
  Layer.provide(
    EventLogServerUnencrypted.layerStoreMappingStatic({
      storeId: EventLogMessage.StoreId.make('default'),
    }),
  ),
  Layer.provide(
    Layer.succeed(EventLogServerUnencrypted.EventLogServerAuthorization, {
      authorizeWrite: () => Effect.void,
      authorizeRead: () => Effect.void,
      authorizeIdentity: () => Effect.void,
    }),
  ),
  Layer.provide(EventLog.layerRegistry),
)

// One device: its own handlers and journal, plus a connection to the server.
// `RpcTest.makeClient` connects straight to the server's handlers in memory.
// A real app connects over a WebSocket with `EventLogRemote.layerUnencrypted`.
const device = (
  name: string,
  identity: EventLog.Identity['Service'],
  seen: Ref.Ref<ReadonlyArray<string>>,
) =>
  EventLog.layer(
    TodoLog,
    EventLog.group(TodoEvents, (handlers) =>
      handlers.handle('TodoAdded', ({ payload }) =>
        Ref.update(seen, (titles) => [...titles, `${name}: ${payload.title}`]),
      ),
    ),
  ).pipe(
    Layer.provideMerge(
      Layer.effectDiscard(
        Effect.gen(function* () {
          const client = yield* RpcTest.makeClient(
            EventLogMessage.EventLogRemoteRpcs,
          )
          yield* EventLogRemote.makeUnencrypted.pipe(
            Effect.provideService(EventLogRemote.EventLogRemoteClient, client),
          )
        }),
      ),
    ),
    Layer.provide(EventLog.layerRegistry),
    Layer.provide(EventJournal.layerMemory),
    Layer.provide(Layer.succeed(EventLog.Identity, identity)),
  )

export const program = Effect.gen(function* () {
  // Both devices belong to the same user, so they share one identity.
  const identity = yield* EventLog.makeIdentity.pipe(
    Effect.provide(EventLogEncryption.layerSubtle),
  )
  const seen = yield* Ref.make<ReadonlyArray<string>>([])

  const server = yield* Layer.build(ServerLive)
  const connect = (name: string) =>
    Layer.build(
      device(name, identity, seen).pipe(
        Layer.provide(Layer.succeedContext(server)),
      ),
    ).pipe(Effect.map(Context.get(EventLog.EventLog)))

  const laptop = yield* connect('laptop')
  const phone = yield* connect('phone')

  // Write on the laptop. Its handler runs straight away, offline or not.
  yield* laptop.write({
    schema: TodoLog,
    event: 'TodoAdded',
    payload: { id: 'todo-1', title: 'Buy milk' },
  })

  // The entry travels laptop → server → phone. We wait until the phone's
  // journal has it.
  yield* phone.entries.pipe(
    Effect.repeat({
      until: (entries) => entries.length === 1,
      schedule: Schedule.spaced('1 millis'),
    }),
  )

  // Each device ran its own handler: the phone replayed the laptop's event.
  yield* Console.log(yield* Ref.get(seen))
}).pipe(Effect.scoped)
