/**
 * @title Adapting a driver cursor
 * @difficulty advanced
 * @summary Many database drivers push rows through callbacks as they arrive.
 * `SqlStream.asyncPauseResume` turns such a producer into a `Stream`, and
 * pauses the producer whenever the consumer falls behind. This is how SQL
 * drivers implement `statement.stream`.
 */

import { Console, Effect, Ref, Stream } from 'effect'
import { SqlStream } from 'effect/sql'

// A stand-in for a driver cursor. It pushes rows to a callback until it is
// paused, and continues when resumed. Real drivers, such as Postgres
// cursors, work the same way. It records what happened so we can see it.
const makeCursor = (rowCount: number, log: Array<string>) => {
  let next = 1
  let paused = false
  return {
    start(onRow: (row: { id: number }) => void, onEnd: () => void) {
      const pump = () => {
        while (!paused && next <= rowCount) onRow({ id: next++ })
        if (!paused && next > rowCount) onEnd()
      }
      return {
        pause: () => {
          paused = true
          log.push(`paused after row ${next - 1}`)
        },
        resume: () => {
          paused = false
          log.push('resumed')
          pump()
        },
        pump,
      }
    },
  }
}

export const program = Effect.gen(function* () {
  const log: Array<string> = []

  // `register` receives `emit` callbacks and returns the pause and resume
  // hooks. The last argument is the buffer size: once two rows are waiting,
  // the stream calls `onPause`, and `onResume` when there is room again.
  const rows = SqlStream.asyncPauseResume<{ id: number }>(
    (emit) =>
      Effect.sync(() => makeCursor(5, log).start(emit.single, emit.end)).pipe(
        // Start pushing in a background fiber, once the hooks are installed.
        Effect.tap((cursor) => Effect.forkScoped(Effect.sync(cursor.pump))),
        Effect.map((cursor) => ({
          onPause: cursor.pause,
          onResume: cursor.resume,
        })),
      ),
    2,
  )

  // A slow consumer. While it works, the buffer fills and the cursor waits
  // instead of piling rows up in memory.
  const seen = yield* Ref.make<Array<number>>([])
  yield* rows.pipe(
    Stream.runForEach((row) =>
      Ref.update(seen, (ids) => [...ids, row.id]).pipe(
        Effect.delay('1 millis'),
      ),
    ),
  )

  yield* Console.log(yield* Ref.get(seen))
  yield* Console.log(log)
})
