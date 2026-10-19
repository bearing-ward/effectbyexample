/**
 * @title Fallbacks with ExecutionPlan
 * @difficulty advanced
 * @summary An `ExecutionPlan` lists the ways to run an effect, in order.
 * Each step provides a different implementation of a service, with its own
 * number of attempts and retry schedule. If every attempt of one step fails,
 * the plan moves on to the next. `ExecutionPlan` is marked unstable.
 */

import {
  Console,
  Context,
  Effect,
  ExecutionPlan,
  Layer,
  Schedule,
  Schema,
} from 'effect'

class SmsUnavailable extends Schema.TaggedError<SmsUnavailable>()(
  'SmsUnavailable',
  {
    provider: Schema.String,
  },
) {}

class InvalidNumber extends Schema.TaggedError<InvalidNumber>()(
  'InvalidNumber',
  {
    phone: Schema.String,
  },
) {}

// The code that sends a message depends only on this service.
class Sms extends Context.Service<
  Sms,
  {
    send(
      phone: string,
      text: string,
    ): Effect.Effect<string, SmsUnavailable | InvalidNumber>
  }
>()('app/Sms') {}

// Two providers. The primary is having an outage. The backup works, but
// both reject numbers that are not in international format.
const provider = (name: string, up: boolean) =>
  Layer.succeed(Sms, {
    send: (phone, text) =>
      !phone.startsWith('+')
        ? Effect.fail(new InvalidNumber({ phone }))
        : up
          ? Effect.succeed(`${name} sent "${text}"`)
          : Effect.fail(new SmsUnavailable({ provider: name })),
  })

// Try the primary twice, ten milliseconds apart. Then move to the backup,
// but only when the failure was an outage. An invalid number would fail at
// the backup too, so `while` stops the plan there.
const plan = ExecutionPlan.make(
  {
    provide: provider('primary', false),
    attempts: 2,
    schedule: Schedule.spaced('10 millis'),
  },
  {
    provide: provider('backup', true),
    while: (error: SmsUnavailable | InvalidNumber) =>
      error._tag === 'SmsUnavailable',
  },
)

const sendCode = (phone: string) =>
  Effect.gen(function* () {
    const sms = yield* Sms
    return yield* sms.send(phone, 'Your code is 4821')
  }).pipe(
    // `withExecutionPlan` provides `Sms` from each step in turn. `onEvent`
    // reports every attempt, which is useful for logs and metrics.
    Effect.withExecutionPlan(plan, {
      onEvent: (event) =>
        event._tag === 'AttemptStart'
          ? Console.log(
              `  step ${event.stepIndex}, attempt ${event.stepAttempt}`,
            )
          : Effect.void,
    }),
  )

export const program = Effect.gen(function* () {
  // The primary fails twice, then the backup succeeds. The caller never
  // sees the outage.
  yield* Console.log('valid number')
  yield* Console.log(yield* sendCode('+15550100'))

  // A bad number fails twice at the primary, because the first step has no
  // `while` and retries any error. The plan does not move on to the
  // backup, and the error reaches the caller.
  yield* Console.log('invalid number')
  const error = yield* sendCode('5550100').pipe(Effect.flip)
  yield* Console.log(error._tag)
})
