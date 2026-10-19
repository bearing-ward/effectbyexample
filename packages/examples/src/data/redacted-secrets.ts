/**
 * @title Keeping secrets out of logs with Redacted
 * @difficulty beginner
 * @summary API keys and passwords end up in logs when someone prints a config
 * object or an error. `Redacted` wraps a secret so that printing, string
 * conversion, and JSON all show a placeholder. You read the real value only
 * where you need it.
 */

import { Console, Effect, Equivalence, Redacted } from 'effect'

interface PaymentConfig {
  readonly endpoint: string
  readonly apiKey: Redacted.Redacted<string>
}

// `Redacted.make` wraps the value. The optional label shows up in the
// placeholder, so you can still tell which secret is which.
const config: PaymentConfig = {
  endpoint: 'https://payments.example.com',
  apiKey: Redacted.make('sk_live_51Hx', { label: 'PAYMENTS_API_KEY' }),
}

// `Redacted.value` reveals the secret. Call it at the last moment, in the
// one place that needs it, such as building a request header.
const authorizationHeader = (key: Redacted.Redacted<string>) =>
  `Bearer ${Redacted.value(key)}`

export const program = Effect.gen(function* () {
  // Logging the whole config is now safe.
  yield* Console.log(config)

  // So are string templates and JSON, the other common ways secrets leak.
  yield* Console.log(`using key ${config.apiKey}`)
  yield* Console.log(JSON.stringify(config))

  // The code that talks to the payment provider still gets the real key. We
  // print its length here, not the key.
  yield* Console.log(
    'header length:',
    authorizationHeader(config.apiKey).length,
  )

  // To compare secrets without revealing them, lift an equivalence for the
  // inner type.
  const sameKey = Redacted.makeEquivalence(Equivalence.String)
  const rotated = Redacted.make('sk_live_77Qp')
  yield* Console.log('key unchanged:', sameKey(config.apiKey, rotated))

  // `wipeUnsafe` deletes the stored value once you are done with it, for
  // example after a one-time token has been used. Reading it afterwards
  // throws.
  const oneTimeToken = Redacted.make('otp-492817')
  Redacted.wipeUnsafe(oneTimeToken)
  const afterWipe = yield* Effect.try(() => Redacted.value(oneTimeToken)).pipe(
    Effect.as('still readable'),
    Effect.catch(() => Effect.succeed('value is gone')),
  )
  yield* Console.log(afterWipe)
})
