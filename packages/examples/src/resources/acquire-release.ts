/**
 * @title Acquire and release
 * @difficulty beginner
 * @summary `Effect.acquireRelease` pairs opening a resource with closing it.
 * The release runs when the surrounding scope closes, whether the work
 * succeeded or failed, and resources close in the reverse order they were
 * opened.
 */

import { Console, Effect, Exit, Schema } from 'effect'

class ExportFailed extends Schema.TaggedError<ExportFailed>()('ExportFailed', {
  reason: Schema.String,
}) {}

// A helper that opens a named resource and closes it again. The release
// function receives the `Exit` of the scope, so it can tell success from
// failure, for example to commit or roll back.
const open = (name: string) =>
  Effect.acquireRelease(
    Effect.as(Console.log(`open ${name}`), name),
    (_, exit) =>
      Console.log(`close ${name} (${Exit.isSuccess(exit) ? 'ok' : 'failed'})`),
  )

// `acquireRelease` adds a `Scope` requirement. The scope decides when the
// release runs. `Effect.scoped` creates one around this export job and
// closes it when the job ends.
const exportOrders = (failAt?: string) =>
  Effect.scoped(
    Effect.gen(function* () {
      const db = yield* open('database')
      const file = yield* open('orders.csv')
      yield* Console.log(`copy rows from ${db} to ${file}`)
      if (failAt !== undefined) {
        return yield* new ExportFailed({ reason: failAt })
      }
      // `Effect.addFinalizer` registers cleanup without a matching acquire.
      yield* Effect.addFinalizer(() => Console.log('report export done'))
    }),
  )

export const program = Effect.gen(function* () {
  // Finalizers run last in, first out: the file closes before the database
  // it was copying from.
  yield* exportOrders()

  yield* Console.log('---')

  // On failure everything opened so far is still closed, and the error
  // continues on to the caller.
  const result = yield* exportOrders('disk full').pipe(
    Effect.catchTag('ExportFailed', (error) =>
      Effect.succeed(`export failed: ${error.reason}`),
    ),
  )
  yield* Console.log(result)
})
