/**
 * @title Polling and interrupting
 * @difficulty intermediate
 * @summary Start a workflow in the background, check on it later by its
 * execution ID, and stop it if it is no longer wanted.
 */

import { Console, Effect, Exit, Layer, Option, Schedule, Schema } from 'effect'
import { DurableDeferred, Workflow, WorkflowEngine } from 'effect/workflow'

const ReportReady = DurableDeferred.make('ReportReady')

const GenerateReport = Workflow.make('GenerateReport', {
  payload: { reportId: Schema.String },
  success: Schema.String,
  idempotencyKey: ({ reportId }) => reportId,
})

const GenerateReportLive = GenerateReport.toLayer(({ reportId }) =>
  Effect.gen(function* () {
    // Waits for a signal that never comes, so the workflow stays suspended.
    yield* DurableDeferred.await(ReportReady)
    return `report ${reportId}`
  }),
)

// `poll` returns `None` for an unknown execution, otherwise the latest
// `Result`: `Suspended`, or `Complete` with an `Exit`.
const describe = (executionId: string) =>
  GenerateReport.poll(executionId).pipe(
    Effect.map(
      Option.match({
        onNone: () => 'unknown',
        onSome: (result) =>
          result._tag === 'Suspended'
            ? 'suspended'
            : Exit.isSuccess(result.exit)
              ? 'completed'
              : 'stopped',
      }),
    ),
  )

const waitUntil = (executionId: string, state: string) =>
  describe(executionId).pipe(
    Effect.repeat({
      until: (current) => current === state,
      schedule: Schedule.spaced('1 millis'),
    }),
  )

export const program = Effect.gen(function* () {
  // Execution IDs are derived from the workflow name and idempotency key, so
  // you can compute one before the workflow has ever run.
  const executionId = yield* GenerateReport.executionId({ reportId: 'q3' })
  yield* Console.log(`before starting: ${yield* describe(executionId)}`)

  yield* GenerateReport.execute({ reportId: 'q3' }, { discard: true })
  yield* Console.log(
    `after starting: ${yield* waitUntil(executionId, 'suspended')}`,
  )

  // `interrupt` stops the execution. Polling then reports it as complete,
  // with an exit that records the interruption.
  yield* GenerateReport.interrupt(executionId)
  yield* Console.log(
    `after interrupting: ${yield* waitUntil(executionId, 'stopped')}`,
  )
}).pipe(
  Effect.provide(
    GenerateReportLive.pipe(Layer.provideMerge(WorkflowEngine.layerMemory)),
  ),
)
