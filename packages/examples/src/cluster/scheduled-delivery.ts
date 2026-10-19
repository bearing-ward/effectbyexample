/**
 * @title Scheduled delivery
 * @difficulty advanced
 * @summary A persisted message can carry its own delivery time. The cluster
 * stores it right away but hands it to the entity only once that time has
 * passed. This example also builds a runner from its parts instead of using
 * `TestRunner`.
 */

import {
  Clock,
  Console,
  DateTime,
  Effect,
  Layer,
  Ref,
  Schedule,
  Schema,
} from 'effect'
import {
  ClusterSchema,
  DeliverAt,
  Entity,
  MessageStorage,
  RunnerHealth,
  Runners,
  RunnerStorage,
  Sharding,
  ShardingConfig,
} from 'effect/cluster'
import { Rpc } from 'effect/rpc'

// A payload opts in by implementing the `DeliverAt` protocol: a method under
// `DeliverAt.symbol` that returns the time to deliver at.
class Reminder extends Schema.Class<Reminder>('Reminder')({
  text: Schema.String,
  sendAt: Schema.DateTimeUtc,
}) {
  [DeliverAt.symbol]() {
    return this.sendAt
  }
}

// Only persisted messages can wait, because waiting means sitting in storage.
const Remind = Rpc.make('Remind', { payload: Reminder }).annotate(
  ClusterSchema.Persisted,
  true,
)
const Inbox = Entity.make('Inbox', [Remind])

// `TestRunner.layer` is this same stack with default settings. Building it
// by hand lets us pass our own `ShardingConfig`. `Sharding` routes messages
// and owns shards. `Runners` talks to other runners, and `layerNoop` means
// there are none. `MessageStorage` keeps persisted messages and
// `RunnerStorage` records runners and shard locks, both in memory here.
// `RunnerHealth` decides whether a runner is alive, and `layerNoop` always
// says yes.
const ClusterLive = Sharding.layer.pipe(
  Layer.provideMerge(Runners.layerNoop),
  Layer.provideMerge(MessageStorage.layerMemory),
  Layer.provide([RunnerStorage.layerMemory, RunnerHealth.layerNoop]),
  // A waiting message is picked up when the runner next polls storage. The
  // default poll interval is 10 seconds; we shorten it for the example.
  Layer.provide(
    ShardingConfig.layer({ entityMessagePollInterval: '20 millis' }),
  ),
)

export const program = Effect.gen(function* () {
  const delivered = yield* Ref.make<ReadonlyArray<string>>([])
  const InboxLive = Inbox.toLayer(
    Inbox.of({
      Remind: ({ payload }) =>
        Ref.update(delivered, (texts) => [...texts, payload.text]),
    }),
  )

  yield* Effect.gen(function* () {
    const inbox = (yield* Inbox.client)('user-1')
    const now = yield* DateTime.now
    const sentAt = yield* Clock.currentTimeMillis

    // The later reminder is sent first.
    yield* inbox.Remind(
      new Reminder({
        text: 'stand up',
        sendAt: DateTime.add(now, { milliseconds: 300 }),
      }),
      { discard: true },
    )
    yield* inbox.Remind(new Reminder({ text: 'drink water', sendAt: now }), {
      discard: true,
    })

    // Shortly after, only the reminder that was due has arrived.
    yield* Effect.sleep('100 millis')
    yield* Console.log(`after 100ms: ${(yield* Ref.get(delivered)).join(', ')}`)

    // Wait for the second one.
    const all = yield* Ref.get(delivered).pipe(
      Effect.repeat({
        until: (texts) => texts.length === 2,
        schedule: Schedule.spaced('10 millis'),
      }),
    )
    const waited = (yield* Clock.currentTimeMillis) - sentAt
    yield* Console.log(`later: ${all.join(', ')}`)
    yield* Console.log(`waited at least 300ms: ${waited >= 300}`)
  }).pipe(Effect.provide(InboxLive.pipe(Layer.provideMerge(ClusterLive))))
})
