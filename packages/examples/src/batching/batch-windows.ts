/**
 * @title Batch windows, sizes, and groups
 * @difficulty advanced
 * @summary By default a resolver batches the requests made at the same
 * moment. `setDelay` waits a little longer to collect more of them,
 * `batchN` caps how many go in one call, and `makeGrouped` splits a batch by
 * a key when the backend can only take one kind of request per call.
 */

import {
  Clock,
  Console,
  Effect,
  Exit,
  Fiber,
  Request,
  RequestResolver,
} from 'effect'
import { TestClock } from 'effect/testing'

// A price depends on the product and the region it ships to.
class GetPrice extends Request.Class<
  { readonly sku: string; readonly region: string },
  number
> {}

export const program = Effect.gen(function* () {
  // The pricing API takes many products, but only one region per call.
  // `makeGrouped` groups pending requests by `key`, and calls the resolver
  // once per group with that key.
  const pricing = RequestResolver.makeGrouped<GetPrice, string>({
    key: (entry) => entry.request.region,
    resolver: (entries, region) =>
      Effect.gen(function* () {
        const now = yield* Clock.currentTimeMillis
        const skus = entries.map((entry) => entry.request.sku)
        yield* Console.log(`${now}ms  ${region}: ${skus.join(', ')}`)
        for (const entry of entries) {
          entry.completeUnsafe(Exit.succeed(region === 'eu' ? 12 : 10))
        }
      }),
  }).pipe(
    // Wait 50 milliseconds after a batch's first request before calling,
    // so requests that arrive soon after join it. The trade-off is added
    // latency for the first caller.
    RequestResolver.setDelay('50 millis'),
    // Never send more than three products in one call. A batch that
    // fills up is sent at once, without waiting for the window to close.
    RequestResolver.batchN(3),
  )

  // A widget waits until its moment, then asks for one price.
  const price = (sku: string, region: string, at: number) =>
    Effect.sleep(at).pipe(
      Effect.andThen(Effect.request(new GetPrice({ sku, region }), pricing)),
    )

  // Page widgets ask for prices at different times, and the test clock
  // makes the timing exact. In the output: the us batch fills up at 30ms
  // and goes out straight away. Each group has its own window, so the eu
  // batch opened at 20ms goes out at 70ms. `pin` at 40ms opens a new us
  // batch, sent when its window ends at 90ms. `hat` arrives late and
  // travels alone.
  const fiber = yield* Effect.forkChild(
    Effect.all(
      [
        price('mug', 'us', 0),
        price('tee', 'us', 10),
        price('cap', 'eu', 20),
        price('bag', 'us', 30),
        price('pin', 'us', 40),
        price('hat', 'us', 120),
      ],
      { concurrency: 'unbounded' },
    ),
  )
  yield* TestClock.adjust('1 second')
  yield* Console.log(yield* Fiber.join(fiber))
}).pipe(Effect.provide(TestClock.layer()))
