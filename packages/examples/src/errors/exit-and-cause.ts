/**
 * @title Exit and Cause
 * @difficulty intermediate
 * @summary When an effect finishes, its `Exit` says how: success with a value,
 * or failure with a `Cause`. The `Cause` keeps the whole story, including
 * defects and failures that happened while cleaning up, so nothing is lost.
 */

import { Cause, Console, Effect, Exit, Option, Schema } from 'effect'

// A `message` field becomes the error's message when it is printed.
class ShipmentLost extends Schema.TaggedError<ShipmentLost>()('ShipmentLost', {
  trackingId: Schema.String,
  message: Schema.String,
}) {}

const track = (trackingId: string) =>
  trackingId === 'TRK-0'
    ? Effect.fail(
        new ShipmentLost({ trackingId, message: `no scans for ${trackingId}` }),
      )
    : Effect.succeed(`${trackingId} delivered`)

// `Exit.match` reads an exit like a `Result`: a value on success, a `Cause`
// on failure.
const describe = (exit: Exit.Exit<string, ShipmentLost>) =>
  Exit.match(exit, {
    onSuccess: (value) => `success: ${value}`,
    onFailure: (cause) =>
      `failure with reasons: ${cause.reasons.map((reason) => reason._tag).join(', ')}`,
  })

export const program = Effect.gen(function* () {
  // `Effect.exit` runs an effect and captures its `Exit` instead of failing.
  yield* Console.log(describe(yield* Effect.exit(track('TRK-1'))))
  yield* Console.log(describe(yield* Effect.exit(track('TRK-0'))))

  // A `Cause` is a list of reasons. `Fail` is an expected error, `Die` is a
  // defect, and `Interrupt` means the fiber was stopped. Here the lookup fails,
  // and then a cleanup step crashes too. Both end up in the same cause.
  const exit = yield* Effect.exit(
    track('TRK-0').pipe(
      Effect.ensuring(Effect.die(new Error('label printer offline'))),
    ),
  )
  yield* Console.log(describe(exit))

  if (Exit.isFailure(exit)) {
    const cause = exit.cause

    // Helpers find the parts you care about. `findErrorOption` gives the
    // first expected error, and `hasDies` asks whether any defect happened.
    const firstError = Cause.findErrorOption(cause)
    if (Option.isSome(firstError)) {
      yield* Console.log('first error:', firstError.value._tag)
    }
    yield* Console.log('has defects:', Cause.hasDies(cause))

    // For logs, `Cause.pretty` renders every reason as one string, stack
    // traces included. `Cause.prettyErrors` gives the same reasons as `Error`
    // values. We print only name and message, because stack traces contain
    // file paths.
    for (const error of Cause.prettyErrors(cause)) {
      yield* Console.log(`${error.name}: ${error.message}`)
    }
  }
})
