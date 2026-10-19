/**
 * @title Running work concurrently
 * @difficulty beginner
 * @summary `Effect.forEach` and `Effect.all` run effects one after another
 * by default. Pass `concurrency` to run several at once, with a limit so
 * you do not overload the service on the other end. Results keep the order
 * of the input either way.
 */

import { Console, Effect, Ref } from 'effect'

export const program = Effect.gen(function* () {
  // We count how many downloads are in flight to see the limit at work.
  const active = yield* Ref.make(0)
  const peak = yield* Ref.make(0)

  const download = (invoiceId: number) =>
    Effect.gen(function* () {
      const now = yield* Ref.updateAndGet(active, (n) => n + 1)
      yield* Ref.update(peak, (most) => Math.max(most, now))
      // Pretend later invoices are faster, so they finish first.
      yield* Effect.sleep(`${10 - invoiceId} millis`)
      yield* Ref.update(active, (n) => n - 1)
      return `invoice-${invoiceId}.pdf`
    })

  const ids = [1, 2, 3, 4, 5, 6]

  // Without options, one download runs at a time.
  yield* Effect.forEach(ids, download)
  yield* Console.log('sequential peak:', yield* Ref.getAndSet(peak, 0))

  // `concurrency: 3` keeps at most three in flight. The results still come
  // back in input order, even though later ones finished first.
  const files = yield* Effect.forEach(ids, download, { concurrency: 3 })
  yield* Console.log('limited peak:', yield* Ref.getAndSet(peak, 0))
  yield* Console.log(files)

  // `'unbounded'` starts everything at once. Use it only when the input is
  // small or the work is cheap.
  yield* Effect.forEach(ids, download, { concurrency: 'unbounded' })
  yield* Console.log('unbounded peak:', yield* Ref.get(peak))

  // `Effect.all` takes the same option for a fixed set of effects, here
  // as a record so each result keeps its name.
  const dashboard = yield* Effect.all(
    { orders: Effect.succeed(12), refunds: Effect.succeed(1) },
    { concurrency: 'unbounded' },
  )
  yield* Console.log(dashboard)

  // If one effect fails, the whole `forEach` fails with that error and
  // stops the downloads that are still running.
  const failed = yield* Effect.forEach(
    ids,
    (id) => (id === 4 ? Effect.fail(`invoice ${id} is missing`) : download(id)),
    { concurrency: 3 },
  ).pipe(Effect.catch((error) => Effect.succeed(`failed: ${error}`)))
  yield* Console.log(failed)
})
