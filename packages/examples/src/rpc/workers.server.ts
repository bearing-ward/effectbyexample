/**
 * @title RPCs in a worker
 * @difficulty advanced
 * @summary Move heavy work off the main thread by serving an RPC group from
 * a worker. The main thread gets an ordinary typed client. `RpcWorker` sends
 * the worker its configuration once, when it starts.
 */

// This file plays both roles. The main thread runs `program`, which spawns a
// worker from this same file. Inside the worker, `isMainThread` is false and
// the server half at the bottom starts instead.
import {
  NodeRuntime,
  NodeWorker,
  NodeWorkerRunner,
} from '@effect/platform-node'
import { Console, Context, Effect, Layer, Schema } from 'effect'
import {
  Rpc,
  RpcClient,
  RpcClientError,
  RpcGroup,
  RpcServer,
  RpcWorker,
} from 'effect/rpc'
import { isMainThread, Worker } from 'node:worker_threads'

class InvoiceRpcs extends RpcGroup.make(
  Rpc.make('TotalInvoice', {
    payload: { lines: Schema.Array(Schema.Number) },
    success: Schema.Struct({
      total: Schema.String,
      onMainThread: Schema.Boolean,
    }),
  }),
) {}

// The initial message is described by a schema, like everything else that
// crosses the boundary.
const WorkerConfig = Schema.Struct({ currency: Schema.String })

// Worker side: read the initial message, then implement the handlers.
const InvoiceHandlers = InvoiceRpcs.toLayer(
  Effect.gen(function* () {
    const { currency } = yield* RpcWorker.initialMessage(WorkerConfig)
    return InvoiceRpcs.of({
      TotalInvoice: ({ lines }) => {
        const cents = lines.reduce((sum, line) => sum + line, 0)
        return Effect.succeed({
          total: `${currency} ${(cents / 100).toFixed(2)}`,
          onMainThread: isMainThread,
        })
      },
    })
  }).pipe(Effect.orDie),
)

// The worker serves the group over the worker protocol, which reads messages
// from the parent thread with `NodeWorkerRunner`.
const WorkerLive = RpcServer.layer(InvoiceRpcs).pipe(
  Layer.provide(InvoiceHandlers),
  Layer.provide(RpcServer.layerProtocolWorkerRunner),
  Layer.provide(NodeWorkerRunner.layer),
)

// Main side: a client whose protocol is a pool of workers. `NodeWorker.layer`
// says how to spawn one, and `layerInitialMessage` says what to send it first.
class InvoiceClient extends Context.Service<
  InvoiceClient,
  RpcClient.RpcClient<
    RpcGroup.Rpcs<typeof InvoiceRpcs>,
    RpcClientError.RpcClientError
  >
>()('app/InvoiceClient') {
  static readonly layer = Layer.effect(
    InvoiceClient,
    RpcClient.make(InvoiceRpcs),
  ).pipe(
    Layer.provide(RpcClient.layerProtocolWorker({ size: 1 })),
    Layer.provide(NodeWorker.layer(() => new Worker(new URL(import.meta.url)))),
    Layer.provide(
      RpcWorker.layerInitialMessage(
        WorkerConfig,
        Effect.succeed({ currency: 'EUR' }),
      ),
    ),
  )
}

export const program = Effect.gen(function* () {
  const client = yield* InvoiceClient
  // The call looks local, but the handler reports that it ran off the main
  // thread. When `program` finishes, the layer's scope closes and the worker
  // is shut down.
  yield* Console.log(yield* client.TotalInvoice({ lines: [1250, 399, 2000] }))
  yield* Console.log(yield* client.TotalInvoice({ lines: [] }))
}).pipe(Effect.provide(InvoiceClient.layer))

if (!isMainThread) {
  Layer.launch(WorkerLive).pipe(NodeRuntime.runMain)
}
