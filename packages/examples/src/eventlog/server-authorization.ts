/**
 * @title Who may write
 * @difficulty advanced
 * @summary Signing in proves who a device belongs to, not what that user may
 * do. The unencrypted server asks an `EventLogServerAuthorization` service
 * before each write and read, and a policy refuses by failing with
 * `EventLogServerAuthError`.
 */

import { Console, Context, Effect, Layer, Queue, Schema, Stream } from 'effect'
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
const storeId = EventLogMessage.StoreId.make('default')

// The policy: editors may write, everyone known may read. A refusal says
// which user and store, and whether the user is unknown (`Unauthorized`) or
// known but not allowed (`Forbidden`). This policy also reports each
// refusal on a queue, as an audit log would.
const policy = (
  roles: ReadonlyMap<string, { name: string; role: 'editor' | 'viewer' }>,
  refused: Queue.Queue<string>,
) => {
  const check = (publicKey: string, allowed: boolean, action: string) => {
    const user = roles.get(publicKey)
    if (user !== undefined && allowed) return Effect.void
    const error = new EventLogServerUnencrypted.EventLogServerAuthError({
      reason: user === undefined ? 'Unauthorized' : 'Forbidden',
      publicKey,
      storeId,
      message: `${user?.name ?? 'unknown user'} may not ${action}`,
    })
    return Queue.offer(refused, `${error.reason}: ${error.message}`).pipe(
      Effect.andThen(Effect.fail(error)),
    )
  }
  return EventLogServerUnencrypted.EventLogServerAuthorization.of({
    authorizeWrite: ({ publicKey }) =>
      check(publicKey, roles.get(publicKey)?.role === 'editor', 'add tasks'),
    authorizeRead: ({ publicKey }) => check(publicKey, true, 'read tasks'),
    authorizeIdentity: ({ publicKey }) => check(publicKey, true, 'sign in'),
  })
}

const device = (identity: EventLog.Identity['Service']) =>
  EventLog.layer(
    TaskLog,
    EventLog.group(TaskEvents, (handlers) =>
      handlers.handle('TaskAdded', () => Effect.void),
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
  const alice = yield* EventLog.makeIdentity
  const bob = yield* EventLog.makeIdentity
  const refused = yield* Queue.unbounded<string>()
  const roles = new Map([
    [alice.publicKey, { name: 'alice', role: 'editor' as const }],
    [bob.publicKey, { name: 'bob', role: 'viewer' as const }],
  ])

  const server = yield* Layer.build(
    EventLogServerUnencrypted.layerNoRpcServer(
      TaskLog,
      EventLog.group(TaskEvents, (handlers) =>
        handlers.handle('TaskAdded', () => Effect.void),
      ),
    ).pipe(
      Layer.provideMerge(EventLogServerUnencrypted.layerStorageMemory),
      Layer.provide(
        EventLogServerUnencrypted.layerStoreMappingStatic({ storeId }),
      ),
      Layer.provide(
        Layer.succeed(
          EventLogServerUnencrypted.EventLogServerAuthorization,
          policy(roles, refused),
        ),
      ),
      Layer.provide(EventLog.layerRegistry),
    ),
  )
  const connect = (identity: EventLog.Identity['Service']) =>
    Layer.build(
      device(identity).pipe(Layer.provide(Layer.succeedContext(server))),
    ).pipe(Effect.map(Context.get(EventLog.EventLog)))
  const bobPhone = yield* connect(bob)
  const aliceLaptop = yield* connect(alice)

  // Bob is a viewer. His device writes locally, then the server refuses
  // the upload. The device receives an `Unauthorized` protocol error carrying
  // the policy's message, keeps the entry, and retries later.
  yield* bobPhone.write({
    schema: TaskLog,
    event: 'TaskAdded',
    payload: { id: 'task-1', title: 'Buy a new printer' },
  })
  yield* Console.log(yield* Queue.take(refused))
  yield* Console.log('bob still has', (yield* bobPhone.entries).length, 'entry')

  // Alice is an editor, so her task is the first entry the server stores.
  yield* aliceLaptop.write({
    schema: TaskLog,
    event: 'TaskAdded',
    payload: { id: 'task-2', title: 'Order toner' },
  })
  const storage = Context.get(server, EventLogServerUnencrypted.Storage)
  const [first] = yield* storage
    .changes({ storeId, startSequence: 0, compactors: new Map() })
    .pipe(Stream.take(1), Stream.runCollect)
  yield* Console.log(
    'server entry',
    first?.remoteSequence,
    first?.entry.primaryKey,
  )
}).pipe(Effect.scoped, Effect.provide(EventLogEncryption.layerSubtle))
