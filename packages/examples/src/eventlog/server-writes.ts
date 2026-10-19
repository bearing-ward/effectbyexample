/**
 * @title Writing from the server
 * @difficulty advanced
 * @summary Not every event starts on a device. A payment webhook or a
 * nightly job runs on the server. `EventLogServerUnencrypted.makeWrite`
 * gives server code a typed writer that runs the server's handlers, stores
 * the entry, and syncs it to every device of the store.
 */

import { Console, Context, Effect, Layer, Schedule, Schema } from 'effect'
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

const OrderEvents = EventGroup.empty.add({
  tag: 'OrderShipped',
  primaryKey: (shipment) => shipment.orderId,
  payload: Schema.Struct({
    orderId: Schema.String,
    carrier: Schema.String.check(Schema.isNonEmpty()),
  }),
})
const OrderLog = EventLog.schema(OrderEvents)

// The server's own handler. It sees an `EventLog.Identity` like any other
// handler; for server writes that is a fixed name for the store.
const ServerHandlers = EventLog.group(OrderEvents, (handlers) =>
  handlers.handle('OrderShipped', () =>
    EventLog.Identity.use((identity) =>
      Console.log('server handler, written by', identity.publicKey),
    ),
  ),
)

// `layerNoRpcServer` builds the `EventLogServerUnencrypted` service inside
// and hides it. To write from server code we assemble the same parts and
// keep it: `layerServer` provides the
// `EventLogServerUnencrypted.EventLogServerUnencrypted` service and the
// handler registry, and `layerRpcHandlers` answers the devices.
const ServerLive = EventLogServerUnencrypted.layerRpcHandlers.pipe(
  Layer.provideMerge(ServerHandlers),
  Layer.provideMerge(EventLogServerUnencrypted.layerServer),
  Layer.provide([
    EventLogServerUnencrypted.layerStorageMemory,
    EventLogServerUnencrypted.layerStoreMappingStatic({
      storeId: EventLogMessage.StoreId.make('default'),
    }),
    Layer.succeed(EventLogServerUnencrypted.EventLogServerAuthorization, {
      authorizeWrite: () => Effect.void,
      authorizeRead: () => Effect.void,
      authorizeIdentity: () => Effect.void,
    }),
  ]),
)

// A customer's phone, connected in memory as in "Syncing devices".
const Phone = EventLog.layer(
  OrderLog,
  EventLog.group(OrderEvents, (handlers) =>
    handlers.handle('OrderShipped', ({ payload }) =>
      Console.log(`phone: ${payload.orderId} shipped with ${payload.carrier}`),
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
  Layer.provide(Layer.effect(EventLog.Identity, EventLog.makeIdentity)),
)

export const program = Effect.gen(function* () {
  const server = yield* Layer.build(ServerLive)
  const phone = yield* Layer.build(
    Phone.pipe(Layer.provide(Layer.succeedContext(server))),
  ).pipe(Effect.map(Context.get(EventLog.EventLog)))

  // The webhook handler: get a writer for the schema, then write. The
  // payload is type-checked against the event, and the store id says which
  // store's devices receive it.
  const write = yield* EventLogServerUnencrypted.makeWrite(OrderLog).pipe(
    Effect.provideContext(server),
  )
  const storeId = EventLogMessage.StoreId.make('default')
  yield* write({
    storeId,
    event: 'OrderShipped',
    payload: { orderId: 'order-1', carrier: 'DHL' },
  })
  yield* phone.entries.pipe(
    Effect.repeat({
      until: (entries) => entries.length === 1,
      schedule: Schedule.spaced('1 millis'),
    }),
  )

  // The payload is encoded with the event's schema before it is stored. An
  // empty carrier fails the `isNonEmpty` check, so nothing is written and
  // the writer fails with `EventLogServerStoreError`.
  const error = yield* write({
    storeId,
    event: 'OrderShipped',
    payload: { orderId: 'order-2', carrier: '' },
  }).pipe(Effect.flip)
  yield* Console.log(
    error instanceof EventLogServerUnencrypted.EventLogServerStoreError,
    error.reason,
    error.message,
  )
}).pipe(Effect.scoped, Effect.provide(EventLogEncryption.layerSubtle))
