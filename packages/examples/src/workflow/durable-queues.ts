/**
 * @title Durable queues
 * @difficulty advanced
 * @summary Some work belongs in a pool of background workers, not inside the
 * workflow: resizing images, calling a rate-limited API. A `DurableQueue`
 * hands a payload to a persisted queue, and the workflow waits, suspended if
 * need be, until a worker sends back the result.
 */

// The queue is stored through `PersistedQueue` from `effect/persistence`.
// The memory store keeps this example self-contained; production code uses
// `PersistedQueue.layerStoreSql` or `layerStoreRedis` so queued items
// survive a restart.
import { Console, Effect, Layer, Schema } from 'effect'
import { PersistedQueue } from 'effect/persistence'
import { DurableQueue, Workflow, WorkflowEngine } from 'effect/workflow'

// A queue has a name, a payload schema, and the schema of the worker's
// answer. The idempotency key identifies an item, so a workflow that replays
// does not queue the same work twice.
const Thumbnails = DurableQueue.make({
  name: 'Thumbnails',
  payload: { photoId: Schema.String, width: Schema.Number },
  success: Schema.String,
  idempotencyKey: ({ photoId, width }) => `${photoId}@${width}`,
})

const PublishPhoto = Workflow.make('PublishPhoto', {
  payload: { photoId: Schema.String },
  success: Schema.Array(Schema.String),
  idempotencyKey: ({ photoId }) => photoId,
})

// `process` offers an item and waits for its result. The wait is a durable
// deferred, so a long queue costs the workflow nothing while it is parked.
const PublishPhotoLive = PublishPhoto.toLayer(({ photoId }) =>
  Effect.gen(function* () {
    const small = yield* DurableQueue.process(Thumbnails, {
      photoId,
      width: 200,
    })
    const large = yield* DurableQueue.process(Thumbnails, {
      photoId,
      width: 800,
    })
    return [small, large]
  }),
)

// The worker is a layer that takes items off the queue and runs the
// handler. It can run in another process than the workflow. Delivery is at
// least once, so the handler must be safe to run twice.
const ThumbnailWorker = DurableQueue.worker(
  Thumbnails,
  ({ photoId, width }) =>
    Console.log(`worker: resize ${photoId} to ${width}px`).pipe(
      Effect.as(`${photoId}-${width}.jpg`),
    ),
  { concurrency: 2 },
)

export const program = Effect.gen(function* () {
  // To the caller this is an ordinary workflow execution.
  const files = yield* PublishPhoto.execute({ photoId: 'beach' })
  yield* Console.log(files)
}).pipe(
  Effect.provide(
    Layer.mergeAll(PublishPhotoLive, ThumbnailWorker).pipe(
      Layer.provideMerge(WorkflowEngine.layerMemory),
      Layer.provide(PersistedQueue.layer),
      Layer.provide(PersistedQueue.layerStoreMemory),
    ),
  ),
)
