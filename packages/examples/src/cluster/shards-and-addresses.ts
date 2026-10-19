/**
 * @title Shards and entity addresses
 * @difficulty intermediate
 * @summary The cluster never tracks entities one by one. It hashes each
 * entity id to a shard, and each shard belongs to exactly one runner at a
 * time. That is why every message for an id ends up in the same place.
 */

import { Console, Effect, Equal, Layer } from 'effect'
import {
  Entity,
  EntityAddress,
  EntityId,
  EntityType,
  Sharding,
  ShardingConfig,
  ShardId,
  TestRunner,
} from 'effect/cluster'
import { Rpc } from 'effect/rpc'

const Locate = Rpc.make('Locate', { success: EntityAddress.EntityAddress })
const Account = Entity.make('Account', [Locate])

// The handler returns its own address, so we can compare it with the one we
// compute from the outside.
const AccountLive = Account.toLayer(
  Effect.gen(function* () {
    const address = yield* Entity.CurrentAddress
    return Account.of({ Locate: () => Effect.succeed(address) })
  }),
)

export const program = Effect.gen(function* () {
  // Entity ids and type names are branded strings. `make` brands a string
  // without checking it.
  const ids = ['acct-1', 'acct-2', 'acct-3'].map((id) => EntityId.make(id))

  // `getShardId` hashes the id into one of `shardsPerGroup` shards. The hash
  // is stable, so the same id maps to the same shard on every machine and
  // after every restart. The test runner uses the default configuration.
  const config = ShardingConfig.defaults
  yield* Console.log(`shards per group: ${config.shardsPerGroup}`)
  for (const id of ids) {
    const shard = yield* Account.getShardId(id)
    yield* Console.log(`${id} -> shard ${shard.id} in group "${shard.group}"`)
  }

  // An address is the full name of one entity: its type, its id, and the
  // shard that owns it.
  const expected = EntityAddress.make({
    entityType: EntityType.make('Account'),
    entityId: EntityId.make('acct-1'),
    shardId: yield* Account.getShardId(EntityId.make('acct-1')),
  })
  yield* Console.log(String(expected))

  // The entity sees the same address when it handles a message.
  const actual = yield* (yield* Account.client)('acct-1').Locate()
  yield* Console.log(`handler agrees: ${Equal.equals(actual, expected)}`)

  // `Sharding` is the service behind it all. Runners divide the shards among
  // themselves, and `hasShardId` says whether this runner currently owns
  // one. A shard id is a group name plus a number from 1 to
  // `shardsPerGroup`. A test runner is alone, so it owns them all.
  const sharding = yield* Sharding.Sharding
  let owned = 0
  for (let id = 1; id <= config.shardsPerGroup; id++) {
    if (sharding.hasShardId(ShardId.make('default', id))) owned++
  }
  yield* Console.log(`shards owned by this runner: ${owned}`)
}).pipe(Effect.provide(AccountLive.pipe(Layer.provideMerge(TestRunner.layer))))
