/**
 * @title Several runners over HTTP
 * @difficulty advanced
 * @summary A real cluster has several runners. They register in shared
 * storage, split the shards between them, and forward each message to the
 * runner that owns its shard. This example starts two runners and a
 * client-only gateway in one process, connected by an in-memory HTTP network.
 */

import { NodeCrypto } from '@effect/platform-node'
import { SqliteClient } from '@effect/sql-sqlite-node'
import {
  Console,
  Effect,
  Layer,
  Option,
  Schedule,
  Schema,
  type Scope,
} from 'effect'
import {
  Entity,
  HttpRunner,
  Runner,
  RunnerAddress,
  RunnerHealth,
  RunnerServer,
  RunnerStorage,
  Sharding,
  ShardingConfig,
  ShardId,
  SqlMessageStorage,
  SqlRunnerStorage,
} from 'effect/cluster'
import { HttpClient, HttpServerRequest, HttpServerResponse } from 'effect/http'
import { Rpc, RpcSerialization } from 'effect/rpc'

// The entity replies with the host of the runner that handled it.
const WhereAreYou = Rpc.make('WhereAreYou', { success: Schema.String })
const Order = Entity.make('Order', [WhereAreYou])
const OrderLive = Order.toLayer(
  Effect.gen(function* () {
    const runner = yield* Entity.CurrentRunnerAddress
    return Order.of({ WhereAreYou: () => Effect.succeed(runner.host) })
  }),
)

// Twelve shards keep the output short. Every runner must agree on this.
const shardsPerGroup = 12

type HttpApp = Effect.Effect<
  HttpServerResponse.HttpServerResponse,
  never,
  Scope.Scope | HttpServerRequest.HttpServerRequest
>

export const program = Effect.gen(function* () {
  // Our "network": an `HttpClient` that delivers each request to the runner
  // whose host and port are in the URL, without opening a socket.
  const servers = new Map<string, HttpApp>()
  const Network = Layer.succeed(
    HttpClient.HttpClient,
    HttpClient.make((request, url) =>
      Effect.gen(function* () {
        const app = servers.get(url.host)
        if (app === undefined)
          return yield* Effect.die(`no runner at ${url.host}`)
        const response = yield* app.pipe(
          Effect.provideService(
            HttpServerRequest.HttpServerRequest,
            HttpServerRequest.fromClientRequest(request),
          ),
          Effect.scoped,
        )
        return HttpServerResponse.toClientResponse(response, { request })
      }),
    ),
  )

  // What every node shares: SQL storage for runners, shard locks, and
  // messages, and HTTP clients that speak the runner protocol as JSON.
  const Shared = Layer.mergeAll(
    SqlRunnerStorage.layer,
    SqlMessageStorage.layer,
    HttpRunner.layerClientProtocolHttpDefault,
  ).pipe(Layer.provide([Network, RpcSerialization.layerJson, NodeCrypto.layer]))

  const config = (runnerAddress: Option.Option<RunnerAddress.RunnerAddress>) =>
    ShardingConfig.layer({
      runnerAddress,
      shardsPerGroup,
      // Faster than the defaults, so the runners settle in about a second.
      refreshAssignmentsInterval: '50 millis',
      entityMessagePollInterval: '50 millis',
    })

  // A runner hosts entities. `HttpRunner.toHttpEffect` is the HTTP handler
  // that receives messages from other runners; a real process would mount
  // it on its HTTP server. `HttpRunner.layerClient` is `Sharding` plus the
  // `Runners` client that sends messages to other runners.
  const runner = (host: string) =>
    Layer.effectDiscard(
      Effect.map(HttpRunner.toHttpEffect, (app) => {
        servers.set(`${host}:34431`, app)
      }),
    ).pipe(
      Layer.provideMerge(OrderLive),
      Layer.provideMerge(HttpRunner.layerClient),
      Layer.provide([
        Shared,
        RunnerHealth.layerNoop,
        RpcSerialization.layerJson,
      ]),
      Layer.provide(config(Option.some(RunnerAddress.make(host, 34431)))),
    )

  // A gateway, like a web server, only sends messages.
  // `RunnerServer.layerClientOnly` gives it `Sharding` without registering
  // it as a runner, so it never owns a shard.
  const Gateway = RunnerServer.layerClientOnly.pipe(
    Layer.provide(Shared),
    Layer.provide(config(Option.none())),
  )

  const runnerA = yield* Layer.build(runner('runner-a'))
  const runnerB = yield* Layer.build(runner('runner-b'))
  const gateway = yield* Layer.build(Gateway)

  // Wait until the two runners have divided all the shards between them.
  const ownedShards = (sharding: Sharding.Sharding['Service']) =>
    Array.from({ length: shardsPerGroup }, (_, i) =>
      ShardId.make('default', i + 1),
    )
      .filter((shardId) => sharding.hasShardId(shardId))
      .map((shardId) => shardId.id)
  const shardingA = yield* Effect.provideContext(Sharding.Sharding, runnerA)
  const shardingB = yield* Effect.provideContext(Sharding.Sharding, runnerB)
  const [shardsA, shardsB] = yield* Effect.sync(() => [
    ownedShards(shardingA),
    ownedShards(shardingB),
  ]).pipe(
    Effect.repeat({
      until: ([a, b]) =>
        a!.length > 0 &&
        b!.length > 0 &&
        a!.length + b!.length === shardsPerGroup,
      schedule: Schedule.spaced('10 millis'),
    }),
  )

  // Both runners are recorded in the database as `Runner` values: an
  // address, the shard groups they serve, and a weight for how many shards
  // they should get. Anything with access to the database can list them.
  const describe = (runner: Runner.Runner) =>
    `${runner.address.host} groups=${runner.groups.join(',')} weight=${runner.weight}`
  const storage = yield* RunnerStorage.RunnerStorage.pipe(
    Effect.provide(
      SqlRunnerStorage.layer.pipe(Layer.provide(config(Option.none()))),
    ),
  )
  const registered = yield* storage.getRunners
  const byHost = registered.toSorted(([a], [b]) =>
    a.address.host.localeCompare(b.address.host),
  )
  for (const [registeredRunner] of byHost) {
    yield* Console.log(`registered: ${describe(registeredRunner)}`)
  }
  yield* Console.log(`runner-a shards: ${shardsA!.join(' ')}`)
  yield* Console.log(`runner-b shards: ${shardsB!.join(' ')}`)

  // The gateway owns no shards. It sends each order to whichever runner
  // owns the order's shard.
  const shardingGateway = yield* Effect.provideContext(
    Sharding.Sharding,
    gateway,
  )
  yield* Console.log(`gateway shards: ${ownedShards(shardingGateway).length}`)
  const orders = yield* Effect.provideContext(Order.client, gateway)
  for (const orderId of ['order-1', 'order-2', 'order-3', 'order-4']) {
    yield* Console.log(
      `${orderId} handled by ${yield* orders(orderId).WhereAreYou()}`,
    )
  }
}).pipe(
  Effect.scoped,
  Effect.provide(SqliteClient.layer({ filename: ':memory:' })),
)
