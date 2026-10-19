/**
 * @title Waiting for signals
 * @difficulty advanced
 * @summary A workflow can pause for hours or days, waiting for a person or
 * another system. While it waits, nothing is left running: it is suspended.
 * When the signal arrives, the engine replays the workflow from the top,
 * reusing every recorded activity result.
 */

import { Console, Effect, Layer, Option, Ref, Schedule, Schema } from 'effect'
import {
  Activity,
  DurableClock,
  DurableDeferred,
  Workflow,
  WorkflowEngine,
} from 'effect/workflow'

// A `DurableDeferred` is a named slot the workflow can wait on. Someone
// outside the workflow fills it later, here with a manager's decision.
const ManagerDecision = DurableDeferred.make('ManagerDecision', {
  success: Schema.Boolean,
})

const ExpenseWorkflow = Workflow.make('Expense', {
  payload: { expenseId: Schema.String, cents: Schema.Number },
  success: Schema.String,
  idempotencyKey: ({ expenseId }) => expenseId,
})

export const program = Effect.gen(function* () {
  const emailsSent = yield* Ref.make(0)

  const ExpenseLive = ExpenseWorkflow.toLayer(({ expenseId, cents }) =>
    Effect.gen(function* () {
      // This line runs again every time the workflow replays. Plain code
      // must therefore be safe to repeat. Side effects belong in activities.
      yield* Console.log(`workflow body runs for ${expenseId}`)

      // An activity runs once. On replay the engine returns the recorded
      // result instead of emailing the manager again.
      yield* Activity.make({
        name: 'EmailManager',
        execute: Ref.update(emailsSent, (count) => count + 1),
      })

      // `await` suspends the workflow until the deferred is completed.
      const approved = yield* DurableDeferred.await(ManagerDecision)

      // `DurableClock.sleep` waits durably: a long sleep survives a restart.
      // Short sleeps like this one simply run in memory.
      yield* DurableClock.sleep({ name: 'CoolOff', duration: '5 millis' })

      return approved ? `paid ${cents} cents` : 'expense rejected'
    }),
  )

  yield* Effect.gen(function* () {
    const payload = { expenseId: 'exp-7', cents: 4200 }

    // `discard: true` starts the workflow without waiting for it, and
    // returns the execution ID.
    const executionId = yield* ExpenseWorkflow.execute(payload, {
      discard: true,
    })

    // `poll` reports the current state without waiting. We check until the
    // workflow reaches the deferred and suspends.
    const result = yield* ExpenseWorkflow.poll(executionId).pipe(
      Effect.repeat({
        until: Option.exists((result) => result._tag === 'Suspended'),
        schedule: Schedule.spaced('1 millis'),
      }),
    )
    yield* Console.log(`state: ${Option.getOrThrow(result)._tag}`)

    // The approval comes from outside, perhaps a link in that email. Anyone
    // who knows the workflow and payload can derive the deferred's token.
    const token = yield* DurableDeferred.tokenFromPayload(ManagerDecision, {
      workflow: ExpenseWorkflow,
      payload,
    })
    yield* DurableDeferred.succeed(ManagerDecision, { token, value: true })

    // Executing again with the same payload joins the running execution and
    // waits for its result.
    yield* Console.log(yield* ExpenseWorkflow.execute(payload))

    // The body ran twice, but the email went out once.
    yield* Console.log(`emails sent: ${yield* Ref.get(emailsSent)}`)
  }).pipe(
    Effect.provide(
      ExpenseLive.pipe(Layer.provideMerge(WorkflowEngine.layerMemory)),
    ),
  )
})
