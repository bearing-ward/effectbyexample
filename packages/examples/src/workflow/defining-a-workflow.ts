/**
 * @title Defining a workflow
 * @difficulty intermediate
 * @summary A workflow is a long-running process that survives restarts.
 * Describe its input and output with schemas, give it an idempotency key, and
 * an engine makes sure each execution happens once.
 */

// Workflows live in `effect/workflow`. The module is marked unstable, so its
// API can still change in a minor release.
import { Console, Effect, Layer, Ref, Schema } from 'effect'
import { Workflow, WorkflowEngine } from 'effect/workflow'

// `Workflow.make` declares a workflow: a unique name, a payload schema, and
// the schemas of its success and error values. Schemas are required because
// the engine stores every input and result so it can resume later.
const SendWelcomeEmail = Workflow.make('SendWelcomeEmail', {
  payload: { userId: Schema.String },
  success: Schema.String,
  // The idempotency key decides which executions are "the same". Executing
  // the workflow twice for one user joins the existing execution instead of
  // sending a second email.
  idempotencyKey: ({ userId }) => userId,
})

export const program = Effect.gen(function* () {
  const emailsSent = yield* Ref.make(0)

  // `toLayer` supplies the implementation. Keeping the definition and the
  // implementation apart lets other services start a workflow without
  // depending on how it runs.
  const SendWelcomeEmailLive = SendWelcomeEmail.toLayer(({ userId }) =>
    Effect.gen(function* () {
      yield* Ref.update(emailsSent, (count) => count + 1)
      return `Welcome email sent to ${userId}`
    }),
  )

  // An engine runs workflows and stores their state. `layerMemory` keeps that
  // state in memory, which suits tests and examples. A production engine
  // stores it durably, for example in a database through Effect Cluster.
  const WorkflowsLive = SendWelcomeEmailLive.pipe(
    Layer.provideMerge(WorkflowEngine.layerMemory),
  )

  yield* Effect.gen(function* () {
    // `execute` starts the workflow and waits for its result.
    yield* Console.log(yield* SendWelcomeEmail.execute({ userId: 'ada' }))

    // Same idempotency key: the engine returns the stored result.
    yield* Console.log(yield* SendWelcomeEmail.execute({ userId: 'ada' }))

    // A different key is a different execution.
    yield* Console.log(yield* SendWelcomeEmail.execute({ userId: 'grace' }))

    // Three calls, two executions.
    yield* Console.log(`emails sent: ${yield* Ref.get(emailsSent)}`)
  }).pipe(Effect.provide(WorkflowsLive))
})
