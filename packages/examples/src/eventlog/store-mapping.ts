/**
 * @title Shared stores with StoreMapping
 * @difficulty advanced
 * @summary On the unencrypted server, a `StoreMapping` decides which server
 * store a device's writes and reads go to. Map every member of a team to
 * one store, and their devices share a log even though each user has their
 * own identity.
 */

import {
  Console,
  Context,
  Effect,
  Layer,
  Schedule,
  Schema,
  Stream,
} from 'effect'
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

const TaskEvents = EventGroup.empty.add({
  tag: 'TaskAdded',
  primaryKey: (task) => task.id,
  payload: Schema.Struct({ id: Schema.String, title: Schema.String }),
})
const TaskLog = EventLog.schema(TaskEvents)
const { StoreId } = EventLogMessage

// Devices always ask for the store named by `EventLog.CurrentStoreId`,
// "default" here. The mapping turns (public key, requested store) into the
// server store to use. Unknown users and unknown store names fail with
// `EventLogServerStoreError`, and the server refuses the request.
const teamMapping = (teamOf: ReadonlyMap<string, string>) => {
  const resolve = (request: {
    readonly publicKey: string
    readonly storeId: EventLogMessage.StoreId
  }) => {
    const team = teamOf.get(request.publicKey)
    return team !== undefined && request.storeId === 'default'
      ? Effect.succeed(StoreId.make(`team-${team}`))
      : Effect.fail(
          new EventLogServerUnencrypted.EventLogServerStoreError({
            reason: 'NotFound',
            storeId: request.storeId,
            message: `no store "${request.storeId}" for this user`,
          }),
        )
  }
  return EventLogServerUnencrypted.StoreMapping.of({
    resolve,
    hasStore: (request) =>
      resolve(request).pipe(
        Effect.as(true),
        Effect.catch(() => Effect.succeed(false)),
      ),
  })
}

// Each user's device, connected in memory as in "Syncing devices".
const device = (name: string, identity: EventLog.Identity['Service']) =>
  EventLog.layer(
    TaskLog,
    EventLog.group(TaskEvents, (handlers) =>
      handlers.handle('TaskAdded', ({ payload }) =>
        Console.log(`${name} sees: ${payload.title}`),
      ),
    ),
  ).pipe(
    Layer.provideMerge(
      Layer.effectDiscard(
        Effect.flatMap(
          RpcTest.makeClient(EventLogMessage.EventLogRemoteRpcs),
          (client) =>
            EventLogRemote.makeUnencrypted.pipe(
              Effect.provideService(
                EventLogRemote.EventLogRemoteClient,
                client,
              ),
            ),
        ),
      ),
    ),
    Layer.provide(EventLog.layerRegistry),
    Layer.provide(EventJournal.layerMemory),
    Layer.provide(Layer.succeed(EventLog.Identity, identity)),
  )

export const program = Effect.gen(function* () {
  const [alice, carol, dave] = yield* Effect.all([
    EventLog.makeIdentity,
    EventLog.makeIdentity,
    EventLog.makeIdentity,
  ])
  const mapping = teamMapping(
    new Map([
      [alice.publicKey, 'acme'],
      [carol.publicKey, 'acme'],
      [dave.publicKey, 'globex'],
    ]),
  )

  const server = yield* Layer.build(
    EventLogServerUnencrypted.layerNoRpcServer(
      TaskLog,
      EventLog.group(TaskEvents, (handlers) =>
        handlers.handle('TaskAdded', () => Effect.void),
      ),
    ).pipe(
      Layer.provideMerge(EventLogServerUnencrypted.layerStorageMemory),
      Layer.provide(
        Layer.succeed(EventLogServerUnencrypted.StoreMapping, mapping),
      ),
      Layer.provide(
        Layer.succeed(EventLogServerUnencrypted.EventLogServerAuthorization, {
          authorizeWrite: () => Effect.void,
          authorizeRead: () => Effect.void,
          authorizeIdentity: () => Effect.void,
        }),
      ),
      Layer.provide(EventLog.layerRegistry),
    ),
  )
  const connect = (name: string, identity: EventLog.Identity['Service']) =>
    Layer.build(
      device(name, identity).pipe(Layer.provide(Layer.succeedContext(server))),
    ).pipe(Effect.map(Context.get(EventLog.EventLog)))

  const aliceLaptop = yield* connect('alice', alice)
  const carolPhone = yield* connect('carol', carol)
  const daveLaptop = yield* connect('dave', dave)

  // Alice and Dave each add a task. Carol is on Alice's team, so her device
  // replays Alice's task. Dave's task goes to another store.
  yield* aliceLaptop.write({
    schema: TaskLog,
    event: 'TaskAdded',
    payload: { id: 'task-1', title: 'Design review' },
  })
  yield* daveLaptop.write({
    schema: TaskLog,
    event: 'TaskAdded',
    payload: { id: 'task-2', title: 'Quarterly report' },
  })
  yield* carolPhone.entries.pipe(
    Effect.repeat({
      until: (entries) => entries.length === 1,
      schedule: Schedule.spaced('1 millis'),
    }),
  )

  // The server's storage holds one store per team.
  const storage = Context.get(server, EventLogServerUnencrypted.Storage)
  for (const team of ['team-acme', 'team-globex']) {
    const [stored] = yield* storage
      .changes({
        storeId: StoreId.make(team),
        startSequence: 0,
        compactors: new Map(),
      })
      .pipe(Stream.take(1), Stream.runCollect)
    yield* Console.log(team, 'holds', stored?.entry.primaryKey)
  }

  // The server calls the mapping on every write and every read. Calling it
  // directly with a store name it does not know shows what a device that
  // asks for "archive" runs into. `hasStore` answers the same question
  // without an error, for your own server code.
  const archive = {
    publicKey: alice.publicKey,
    storeId: StoreId.make('archive'),
  }
  yield* Console.log('has archive:', yield* mapping.hasStore(archive))
  const error = yield* Effect.flip(mapping.resolve(archive))
  yield* Console.log(error._tag, error.reason, error.message)
}).pipe(Effect.scoped, Effect.provide(EventLogEncryption.layerSubtle))
