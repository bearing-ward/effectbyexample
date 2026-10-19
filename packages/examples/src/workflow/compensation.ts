/**
 * @title Compensation
 * @difficulty advanced
 * @summary When step four of a five-step process fails, steps one to three
 * need undoing. Attach a compensation to each step, and the workflow runs
 * them in reverse order if it fails. This is the saga pattern.
 */

import { Console, Effect, Layer, Schema } from 'effect'
import { Activity, Workflow, WorkflowEngine } from 'effect/workflow'

class BookingFailed extends Schema.TaggedError<BookingFailed>()(
  'BookingFailed',
  { reason: Schema.String },
) {}

const BookTrip = Workflow.make('BookTrip', {
  payload: { tripId: Schema.String },
  success: Schema.String,
  error: BookingFailed,
  idempotencyKey: ({ tripId }) => tripId,
})

const book = (name: string, reference: string) =>
  Activity.make({
    name,
    success: Schema.String,
    execute: Console.log(`booked ${reference}`).pipe(Effect.as(reference)),
  })

export const program = Effect.gen(function* () {
  const BookTripLive = BookTrip.toLayer(() =>
    Effect.gen(function* () {
      // `withCompensation` registers an undo step that receives the result of
      // the step it follows. It only runs if the whole workflow fails.
      const flight = yield* book('BookFlight', 'flight LH-401').pipe(
        BookTrip.withCompensation((reference) =>
          Console.log(`cancelled ${reference}`),
        ),
      )
      const hotel = yield* book('BookHotel', 'hotel room 12').pipe(
        BookTrip.withCompensation((reference) =>
          Console.log(`cancelled ${reference}`),
        ),
      )

      // The third booking fails, so the workflow fails...
      yield* Activity.make({
        name: 'BookCar',
        error: BookingFailed,
        execute: new BookingFailed({ reason: 'no cars available' }),
      })

      return `${flight}, ${hotel}`
    }),
  )

  // ...and the hotel is cancelled before the flight, newest first.
  const outcome = yield* BookTrip.execute({ tripId: 'trip-1' }).pipe(
    Effect.catchTag('BookingFailed', (error) =>
      Effect.succeed(`trip not booked: ${error.reason}`),
    ),
    Effect.provide(
      BookTripLive.pipe(Layer.provideMerge(WorkflowEngine.layerMemory)),
    ),
  )
  yield* Console.log(outcome)
})
