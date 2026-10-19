/**
 * @title Deploying runners on Kubernetes
 * @difficulty advanced
 * @summary In production each pod is a runner. It reads its address from
 * the environment, talks to other runners over sockets, and asks the
 * Kubernetes API which pods are ready before taking shards from a runner
 * that stopped answering. This example runs those pieces against a fake
 * Kubernetes API.
 */

import {
  ConfigProvider,
  Console,
  Effect,
  FileSystem,
  Layer,
  Option,
} from 'effect'
import {
  K8sHttpClient,
  K8sTypes,
  RunnerAddress,
  RunnerHealth,
  ShardingConfig,
  SocketRunner,
} from 'effect/cluster'
import { HttpClient, HttpServerResponse } from 'effect/http'

// `K8sTypes` has the Kubernetes `Pod` types. Two runner pods: one ready,
// one that started but never became ready.
const pod = (ip: string, ready: boolean): K8sTypes.Pod => ({
  metadata: { name: `orders-${ip.replaceAll('.', '-')}` },
  status: {
    phase: 'Running',
    podIP: ip,
    hostIP: '10.0.0.1',
    conditions: [
      {
        type: 'Initialized',
        status: 'True',
        lastTransitionTime: '2026-01-05T09:00:00Z',
      },
      {
        type: 'Ready',
        status: ready ? 'True' : 'False',
        lastTransitionTime: '2026-01-05T09:01:00Z',
      },
    ],
  },
})

// A fake Kubernetes API that prints each request and lists the pods.
const FakeKubernetesApi = Layer.succeed(
  HttpClient.HttpClient,
  HttpClient.make((request, url) =>
    Effect.gen(function* () {
      yield* Console.log(`${request.method} ${url.origin}${url.pathname}`)
      yield* Console.log(`  ${decodeURIComponent(url.search)}`)
      yield* Console.log(`  authorization: ${request.headers.authorization}`)
      const items = [pod('10.0.1.5', true), pod('10.0.1.6', false)]
      const response = HttpServerResponse.jsonUnsafe({ items })
      return HttpServerResponse.toClientResponse(response, { request })
    }),
  ),
)

// Inside a pod, the service account token is a mounted file.
const ServiceAccountToken = FileSystem.layerNoop({
  readFileString: () => Effect.succeed('service-account-token\n'),
})

export const program = Effect.gen(function* () {
  // `ShardingConfig.layerFromEnv` reads settings like `HOST`, `PORT`, and
  // `SHARDS_PER_GROUP` from the environment. Here we feed the same config a
  // fixed environment, as a pod spec would set it.
  const config = yield* ShardingConfig.config.pipe(
    Effect.provideService(
      ConfigProvider.ConfigProvider,
      ConfigProvider.fromEnv({
        env: { HOST: '10.0.1.5', PORT: '34431', SHARDS_PER_GROUP: '600' },
      }).pipe(ConfigProvider.constantCase),
    ),
  )
  const address = Option.getOrThrow(config.runnerAddress)
  yield* Console.log(`this runner: ${address.host}:${address.port}`)
  yield* Console.log(`shards per group: ${config.shardsPerGroup}`)

  // `RunnerHealth.layerK8s` answers "is this runner alive?" by looking up
  // its pod. `K8sHttpClient.layer` points an `HttpClient` at the in-cluster
  // API and adds the service account token.
  const health = yield* RunnerHealth.RunnerHealth.pipe(
    Effect.provide(
      RunnerHealth.layerK8s({
        namespace: 'shop',
        labelSelector: 'app=orders',
      }).pipe(
        Layer.provide(K8sHttpClient.layer),
        Layer.provide([FakeKubernetesApi, ServiceAccountToken]),
      ),
    ),
  )

  // Runners are matched to pods by IP. A pod that is not ready, or no pod at
  // all, means the runner is not alive and its shards can move. The pod list
  // is cached for ten seconds, so these three checks make one request.
  for (const ip of ['10.0.1.5', '10.0.1.6', '10.0.1.7']) {
    const alive = yield* health.isAlive(RunnerAddress.make(ip, 34431))
    yield* Console.log(`${ip} alive: ${alive}`)
  }

  // A runner pod puts it together with `SocketRunner.layer`, which serves
  // runner-to-runner RPCs on a `SocketServer`. We only describe the layer
  // here: building it needs a `SocketServer`, which would open a port. In Node, `NodeClusterSocket`
  // from `@effect/platform-node` wires this up with a TCP server, SQL
  // storage, and the health check of your choice.
  const RunnerPod = SocketRunner.layer.pipe(
    Layer.provide(RunnerHealth.layerK8s({ namespace: 'shop' })),
    Layer.provide(ShardingConfig.layerFromEnv()),
  )
  yield* Console.log(`runner layer described: ${Layer.isLayer(RunnerPod)}`)
})
