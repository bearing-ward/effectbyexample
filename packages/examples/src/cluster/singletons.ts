/**
 * @title Singletons
 * @difficulty intermediate
 * @summary Some background work must run exactly once across the whole
 * cluster, like relaying an outbox table to a message queue. A singleton is
 * an effect that the cluster starts on one runner only, and moves to another
 * runner if that one goes away.
 */

import {
  Console,
  Deferred,
  Effect,
  Equal,
  Exit,
  Fiber,
  Layer,
  Metric,
  Scope,
  Stream,
} from 'effect'
import {
  ClusterMetrics,
  EntityId,
  Sharding,
  ShardingRegistrationEvent,
  Singleton,
  SingletonAddress,
  TestRunner,
} from 'effect/cluster'

export const program = Effect.gen(function* () {
  const started = yield* Deferred.make<void>()

  // `Singleton.make` takes a name and the effect to run. The name is hashed
  // to a shard, just like an entity id, and whichever runner owns that shard
  // runs the effect. Here it runs until it is interrupted.
  const OutboxRelay = Singleton.make(
    'OutboxRelay',
    Effect.gen(function* () {
      yield* Console.log('relay started')
      yield* Deferred.succeed(started, undefined)
      return yield* Effect.never
    }).pipe(Effect.onInterrupt(() => Console.log('relay stopped'))),
  )

  // `Sharding` publishes a `ShardingRegistrationEvent` whenever an entity or
  // singleton is registered on this runner. We subscribe before registering.
  const sharding = yield* Sharding.Sharding
  const events = yield* sharding.getRegistrationEvents.pipe(
    Stream.take(1),
    Stream.runCollect,
    Effect.forkChild({ startImmediately: true }),
  )

  // Build the singleton layer in its own scope, so we can stop it later.
  const scope = yield* Scope.make()
  yield* Layer.buildWithScope(OutboxRelay, scope)

  // The singleton starts once this runner has acquired its shard.
  yield* Deferred.await(started)

  // The event carries a `SingletonAddress`: the name plus the shard it
  // lives on. That shard is the one the name hashes to.
  const expected = new SingletonAddress.SingletonAddress({
    name: 'OutboxRelay',
    shardId: sharding.getShardId(EntityId.make('OutboxRelay'), 'default'),
  })
  for (const event of yield* Fiber.join(events)) {
    yield* Console.log(
      ShardingRegistrationEvent.match(event, {
        EntityRegistered: ({ entity }) => `registered entity ${entity.type}`,
        SingletonRegistered: ({ address }) =>
          `registered singleton ${address.name} on shard ${address.shardId}, ` +
          `as expected: ${Equal.equals(address, expected)}`,
      }),
    )
  }

  // `ClusterMetrics` holds gauges the runner keeps up to date, ready for a
  // metrics exporter. This one counts the shards this runner owns.
  const shards = yield* Metric.value(ClusterMetrics.shards)
  yield* Console.log(`shards owned: ${shards.value}`)

  // Closing the scope unregisters the singleton and interrupts it. On a real
  // cluster the same happens when its shard moves to another runner, which
  // then starts its own copy.
  yield* Scope.close(scope, Exit.void)
}).pipe(Effect.provide(TestRunner.layer))
