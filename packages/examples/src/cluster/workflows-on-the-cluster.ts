/**
 * @title Running workflows on the cluster
 * @difficulty advanced
 * @summary The workflow examples use an in-memory engine. In production,
 * `ClusterWorkflowEngine` runs the same workflows on the cluster: each
 * execution is an entity, each step is a persisted message, and a durable
 * sleep is a message scheduled for later.
 */

import { Clock, Console, Effect, Layer, Option, Schedule, Schema } from 'effect'
import {
  ClusterWorkflowEngine,
  MessageStorage,
  TestRunner,
} from 'effect/cluster'
import { TestClock } from 'effect/testing'
import { Activity, DurableClock, Workflow } from 'effect/workflow'

// The workflow is defined exactly as in the workflow examples. Nothing in it
// mentions the cluster.
const ChaseInvoice = Workflow.make('ChaseInvoice', {
  payload: { invoiceId: Schema.String },
  success: Schema.String,
  idempotencyKey: ({ invoiceId }) => invoiceId,
})

const ChaseInvoiceLive = ChaseInvoice.toLayer(({ invoiceId }) =>
  Effect.gen(function* () {
    yield* Activity.make({
      name: 'SendInvoice',
      execute: Console.log(`sent invoice ${invoiceId}`),
    })
    // A sleep longer than a minute is stored by the engine instead of being
    // held in memory, so it survives a restart.
    yield* DurableClock.sleep({ name: 'GracePeriod', duration: '1 hour' })
    yield* Activity.make({
      name: 'SendReminder',
      execute: Console.log(`sent reminder for ${invoiceId}`),
    })
    return `chased ${invoiceId}`
  }),
)

// Only the engine layer changes: `ClusterWorkflowEngine.layer` in place of
// `WorkflowEngine.layerMemory`. It needs `Sharding` and `MessageStorage`,
// which the test runner provides.
const WorkflowsLive = ChaseInvoiceLive.pipe(
  Layer.provideMerge(ClusterWorkflowEngine.layer),
  Layer.provideMerge(TestRunner.layer),
)

// Lists what the engine has written to cluster storage: which entity each
// message went to, which RPC it was, and when it is due, if it is scheduled.
const storedMessages = Effect.gen(function* () {
  const storage = yield* MessageStorage.MemoryDriver
  const now = yield* Clock.currentTimeMillis
  return [...storage.requests.values()].flatMap(({ envelope, deliverAt }) =>
    envelope._tag === 'Request'
      ? [
          `${envelope.address.entityType} ${envelope.tag}` +
            (deliverAt === null
              ? ''
              : `, due in ${(deliverAt - now) / 60_000} minutes`),
        ]
      : [],
  )
})

export const program = Effect.gen(function* () {
  // An hour-long sleep needs a clock we can move.
  yield* TestClock.setTime(Date.UTC(2026, 0, 5, 9))

  yield* Effect.gen(function* () {
    const executionId = yield* ChaseInvoice.execute(
      { invoiceId: 'inv-42' },
      { discard: true },
    )
    yield* ChaseInvoice.poll(executionId).pipe(
      Effect.repeat({
        until: Option.exists((result) => result._tag === 'Suspended'),
        schedule: Schedule.spaced('1 millis'),
      }),
      TestClock.withLive,
    )

    // While suspended, the workflow is only rows in storage. The execution
    // is an entity named after the workflow, and the sleep is a message to
    // the engine's clock entity, scheduled an hour ahead.
    yield* Console.log('stored while suspended:')
    for (const line of yield* storedMessages) yield* Console.log(`  ${line}`)

    // When the hour passes, the clock message is delivered, and it resumes
    // the workflow.
    yield* TestClock.adjust('1 hour')
    yield* Console.log(yield* ChaseInvoice.execute({ invoiceId: 'inv-42' }))
  }).pipe(Effect.provide(WorkflowsLive))
}).pipe(Effect.provide(TestClock.layer()))
