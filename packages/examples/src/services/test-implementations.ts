/**
 * @title Swapping implementations for tests
 * @difficulty beginner
 * @summary Because code asks for a service instead of importing an
 * implementation, a test can hand it a different one. The business logic
 * stays the same; only the layer changes.
 */

import { Console, Context, Effect, Layer } from 'effect'

// The payment gateway is the part we do not want to call from a test.
class PaymentGateway extends Context.Service<
  PaymentGateway,
  {
    readonly charge: (customer: string, cents: number) => Effect.Effect<string>
    readonly refund: (chargeId: string) => Effect.Effect<void>
  }
>()('app/PaymentGateway') {
  // The real layer would talk to the payment provider over the network.
  static readonly layer = Layer.succeed(PaymentGateway, {
    charge: () => Effect.die('the live gateway is not reachable here'),
    refund: () => Effect.die('the live gateway is not reachable here'),
  })
}

// The business logic only knows the service interface.
const checkout = Effect.fn('checkout')(function* (
  customer: string,
  items: ReadonlyArray<number>,
) {
  const gateway = yield* PaymentGateway
  const total = items.reduce((sum, cents) => sum + cents, 0)
  const chargeId = yield* gateway.charge(customer, total)
  return `${customer} paid ${total} cents (${chargeId})`
})

export const program = Effect.gen(function* () {
  // A fake gateway records what it was asked to do, so the test can check
  // the calls without any network.
  const charges: Array<string> = []
  const FakeGateway = Layer.succeed(PaymentGateway, {
    charge: (customer, cents) =>
      Effect.sync(() => {
        charges.push(`${customer}:${cents}`)
        return `ch_${charges.length}`
      }),
    refund: () => Effect.void,
  })

  yield* Console.log(
    yield* checkout('ada', [1200, 350]).pipe(Effect.provide(FakeGateway)),
  )
  yield* Console.log('recorded charges:', charges)

  // `Layer.mock` takes a partial implementation. Any member you leave out
  // is a stub that dies if called, so a test fails loudly when the code
  // touches something the test did not expect.
  const ChargeOnly = Layer.mock(PaymentGateway, {
    charge: () => Effect.succeed('ch_mock'),
  })
  yield* Console.log(
    yield* checkout('grace', [500]).pipe(Effect.provide(ChargeOnly)),
  )

  const refunded = yield* PaymentGateway.use((gateway) =>
    gateway.refund('ch_mock'),
  ).pipe(
    Effect.provide(ChargeOnly),
    Effect.as('refunded'),
    Effect.catchDefect(() => Effect.succeed('refund is not implemented')),
  )
  yield* Console.log(refunded)
})
