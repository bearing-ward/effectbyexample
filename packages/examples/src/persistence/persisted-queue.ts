/**
 * @title Persisted queues
 * @difficulty intermediate
 * @summary A `PersistedQueue` stores jobs durably, so work offered by one
 * process can be done by another, even after a crash. A job is marked done
 * only when its handler succeeds; a failure puts it back for a retry.
 */

import { Console, Effect, Layer, Ref, Schedule, Schema } from 'effect'
import { PersistedQueue } from 'effect/persistence'

class SendEmail extends Schema.Class<SendEmail>('SendEmail')({
  to: Schema.String,
  subject: Schema.String,
}) {}

export const program = Effect.gen(function* () {
  // A queue has a name and a schema for its jobs. The retry schedule spaces
  // out attempts after a failure, and `maxAttempts` gives up eventually.
  const emails = yield* PersistedQueue.make({
    name: 'emails',
    schema: SendEmail,
    maxAttempts: 3,
    retrySchedule: Schedule.spaced('10 millis'),
  })

  // `offer` stores a job and returns its id. Passing your own id makes the
  // offer idempotent: offering the same id again does nothing.
  yield* emails.offer(
    new SendEmail({ to: 'ada@example.com', subject: 'Welcome' }),
    { id: 'welcome-ada' },
  )
  yield* emails.offer(
    new SendEmail({ to: 'ada@example.com', subject: 'Welcome' }),
    { id: 'welcome-ada' },
  )
  yield* emails.offer(
    new SendEmail({ to: 'grace@example.com', subject: 'Welcome' }),
    { id: 'welcome-grace' },
  )

  // A flaky mail server: the first attempt for Grace fails.
  const failuresLeft = yield* Ref.make(1)
  const send = (email: SendEmail, attempt: number) =>
    Effect.gen(function* () {
      if (email.to.startsWith('grace') && (yield* Ref.get(failuresLeft)) > 0) {
        yield* Ref.update(failuresLeft, (n) => n - 1)
        yield* Console.log(`attempt ${attempt}: ${email.to} failed`)
        return yield* Effect.fail('mail server unavailable')
      }
      yield* Console.log(
        `attempt ${attempt}: sent "${email.subject}" to ${email.to}`,
      )
    })

  // `take` waits for a job and runs the handler with it. The handler also
  // gets the job id and which attempt this is. Failing puts the job back.
  // Delivery is at least once, so handlers should be safe to repeat.
  const worker = emails.take((email, { attempts }) => send(email, attempts))
  yield* worker
  yield* worker.pipe(Effect.ignore)
  yield* worker

  // Both jobs are done and the duplicate offer added nothing, so the queue is
  // empty. Another `take` would wait for new work; this one gives up.
  const idle = yield* worker.pipe(Effect.timeoutOption('50 millis'))
  yield* Console.log(idle)
}).pipe(
  // The memory store suits tests. `layerStoreSql` and `layerStoreRedis` keep
  // jobs across restarts and share them between processes.
  Effect.provide(
    PersistedQueue.layer.pipe(Layer.provide(PersistedQueue.layerStoreMemory)),
  ),
)
