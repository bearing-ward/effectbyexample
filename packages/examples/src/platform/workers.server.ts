/**
 * @title Workers
 * @difficulty advanced
 * @summary A `Worker` sends messages to code running in another thread, and a
 * `WorkerRunner` is the other end: it receives those messages and replies.
 * `Transferable` schemas move large buffers to the worker instead of
 * copying them.
 */

// The worker modules live in `effect/workers` and are marked unstable.
// The browser platform speaks to anything with `postMessage`, including a
// `MessagePort`.
import { BrowserWorker, BrowserWorkerRunner } from '@effect/platform-browser'
import { Console, Effect, Queue, Schema } from 'effect'
import { Transferable, Worker, WorkerError, WorkerRunner } from 'effect/workers'

// A job carries raw image bytes. `Transferable.Uint8Array` marks the bytes
// as transferable: encoding the job records their buffer, so `postMessage`
// can move it instead of copying.
const Job = Schema.Struct({ id: Schema.Int, pixels: Transferable.Uint8Array })
interface Reply {
  readonly id: number
  readonly brightness: number
}

// The worker's side. In an app this lives in its own file, started with
// `new Worker(...)`, and uses `BrowserWorkerRunner.layer` or
// `NodeWorkerRunner.layer`. It answers each job on the port it came from.
const runWorker = Effect.gen(function* () {
  const platform = yield* WorkerRunner.WorkerRunnerPlatform
  const runner = yield* platform.start<Reply, typeof Job.Encoded>()
  yield* runner.run((portId, job) => {
    const total = job.pixels.reduce((sum, value) => sum + value, 0)
    return runner.send(portId, {
      id: job.id,
      brightness: Math.round(total / job.pixels.length),
    })
  })
})

// The main thread's side. It spawns a worker through the `WorkerPlatform`
// service, and `run` handles every message the worker sends back.
const useWorker = Effect.gen(function* () {
  const platform = yield* Worker.WorkerPlatform
  const worker = yield* platform.spawn<Reply, typeof Job.Encoded>(0)
  const replies = yield* Queue.unbounded<Reply>()
  yield* worker
    .run((reply) => Queue.offer(replies, reply))
    .pipe(Effect.forkScoped)

  // Encode the job with a collector to find out what can be transferred,
  // then send it with that transfer list.
  const pixels = new Uint8Array([10, 200, 30, 120])
  const collector = yield* Transferable.makeCollector
  const encoded = yield* Schema.encodeEffect(Job)({ id: 1, pixels }).pipe(
    Effect.provideService(Transferable.Collector, collector),
  )
  yield* worker.send(encoded, yield* collector.clear)
  yield* Console.log(yield* Queue.take(replies))

  // The buffer moved to the other side, so it is now empty here.
  yield* Console.log(`bytes left on the main thread: ${pixels.byteLength}`)

  // Messages must survive structured cloning. A function does not, so
  // sending one fails with a `WorkerError` instead of throwing.
  const failure = yield* worker
    .send({ id: 2, pixels: () => [] } as unknown as typeof Job.Encoded)
    .pipe(Effect.flip)
  yield* Console.log(WorkerError.isWorkerError(failure), failure.reason._tag)
})

export const program = Effect.gen(function* () {
  // A `MessageChannel` stands in for the thread boundary: one port for each
  // side. Both sides run in this one program so the example fits in a file.
  const channel = new MessageChannel()
  yield* runWorker.pipe(
    Effect.provide(BrowserWorkerRunner.layerMessagePort(channel.port2)),
    Effect.forkScoped,
  )

  // `BrowserWorker.layer` takes the function that starts a worker. In an app
  // it returns `new Worker(new URL('./worker.ts', import.meta.url))`; here it
  // returns the main thread's end of the channel.
  yield* useWorker.pipe(
    Effect.provide(BrowserWorker.layer(() => channel.port1)),
  )
}).pipe(Effect.scoped)
