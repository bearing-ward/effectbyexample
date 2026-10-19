/**
 * @title Activities
 * @difficulty intermediate
 * @summary Activities are the steps of a workflow that touch the outside world:
 * charging a card, sending an email, calling an API. The engine records each
 * result, and retries an activity that fails.
 */

import { Console, Effect, Layer, Ref, Schema } from 'effect'
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow'

class CardDeclined extends Schema.TaggedError<CardDeclined>()('CardDeclined', {
  reason: Schema.String,
}) {}

const CheckoutWorkflow = Workflow.make('Checkout', {
  payload: { orderId: Schema.String, cents: Schema.Number },
  success: Schema.String,
  error: CardDeclined,
  idempotencyKey: ({ orderId }) => orderId,
})

export const program = Effect.gen(function* () {
  // Pretend the payment network times out twice before it succeeds.
  const calls = yield* Ref.make(0)
  const chargeCard = (cents: number) =>
    Effect.gen(function* () {
      const call = yield* Ref.updateAndGet(calls, (count) => count + 1)
      if (call < 3) {
        return yield* new CardDeclined({ reason: 'network timeout' })
      }
      return `receipt for ${cents} cents`
    })

  const CheckoutLive = CheckoutWorkflow.toLayer(({ cents }) =>
    Effect.gen(function* () {
      // `Activity.make` wraps one side effect. Its name must be unique within
      // the workflow, and its schemas let the engine store the outcome.
      const receipt = yield* Activity.make({
        name: 'ChargeCard',
        success: Schema.String,
        error: CardDeclined,
        execute: Effect.gen(function* () {
          // `CurrentAttempt` tells the activity which attempt this is, which
          // is useful for logging or for backing off.
          const attempt = yield* Activity.CurrentAttempt
          yield* Console.log(`charging card, attempt ${attempt}`)
          return yield* chargeCard(cents)
        }),
        // `Activity.retry` reruns a failed activity. Unlike a plain
        // `Effect.retry`, it keeps the attempt count in step with the engine.
      }).pipe(Activity.retry({ times: 5 }))

      return receipt
    }),
  )

  const result = yield* CheckoutWorkflow.execute({
    orderId: 'order-1',
    cents: 2500,
  }).pipe(
    Effect.provide(
      CheckoutLive.pipe(Layer.provideMerge(WorkflowEngine.layerMemory)),
    ),
  )
  yield* Console.log(result)
})
