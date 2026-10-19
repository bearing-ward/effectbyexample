/**
 * @title Swapping resources with ScopedRef
 * @difficulty intermediate
 * @summary A `ScopedRef` holds one resource at a time. Setting a new one
 * opens it, then closes the old one, so you never leak the value you
 * replaced. Log files that rotate and connections that move to a new server
 * are typical uses.
 */

import { Console, Effect, ScopedRef, Schema } from 'effect'

class OpenFailed extends Schema.TaggedError<OpenFailed>()('OpenFailed', {
  file: Schema.String,
}) {}

// Opening a log file is a scoped resource that announces both ends.
const openLog = (file: string) =>
  Effect.acquireRelease(Effect.as(Console.log(`open ${file}`), { file }), () =>
    Console.log(`close ${file}`),
  )

const write = (
  ref: ScopedRef.ScopedRef<{ readonly file: string }>,
  line: string,
) =>
  Effect.gen(function* () {
    const log = yield* ScopedRef.get(ref)
    yield* Console.log(`  ${log.file} <- ${line}`)
  })

export const program = Effect.gen(function* () {
  // `fromAcquire` opens the first value. The ref needs a scope: it owns
  // whatever value it holds at the end and closes it then.
  const current = yield* ScopedRef.fromAcquire(openLog('app-1.log'))
  yield* write(current, 'order placed')

  // `set` opens the new file, swaps it in, and closes the old one.
  yield* ScopedRef.set(current, openLog('app-2.log'))
  yield* write(current, 'order shipped')

  // If opening the replacement fails, the old value stays in place.
  const swapped = yield* ScopedRef.set(
    current,
    Effect.fail(new OpenFailed({ file: 'app-3.log' })),
  ).pipe(
    Effect.as('rotated'),
    Effect.catchTag('OpenFailed', (error) =>
      Effect.succeed(`could not open ${error.file}`),
    ),
  )
  yield* Console.log(swapped)
  yield* write(current, 'order delivered')

  yield* Console.log('shutting down')
}).pipe(Effect.scoped)
