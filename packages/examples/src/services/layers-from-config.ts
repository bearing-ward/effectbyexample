/**
 * @title Choosing a layer from config
 * @difficulty intermediate
 * @summary Sometimes the implementation itself depends on configuration: an
 * in-memory store for local runs, a remote one in production. `Layer.unwrap`
 * runs an Effect that reads config and returns the layer to use.
 */

import { Config, ConfigProvider, Console, Context, Effect, Layer } from 'effect'

class Mailer extends Context.Service<
  Mailer,
  { readonly send: (to: string, subject: string) => Effect.Effect<string> }
>()('app/Mailer') {
  // Two implementations of the same service.
  static readonly layerConsole = Layer.succeed(Mailer, {
    send: (to, subject) => Effect.succeed(`[console] ${to}: ${subject}`),
  })

  static readonly layerSmtp = (host: string) =>
    Layer.succeed(Mailer, {
      send: (to, subject) => Effect.succeed(`[smtp ${host}] ${to}: ${subject}`),
    })

  // `Layer.unwrap` turns `Effect<Layer>` into a `Layer`. The config is read
  // when the layer is built, so each environment can pick differently. The
  // SMTP host is only required when SMTP is chosen.
  static readonly layer = Layer.unwrap(
    Effect.gen(function* () {
      const transport = yield* Config.Literals(
        ['console', 'smtp'],
        'MAIL_TRANSPORT',
      ).pipe(Config.withDefault('console'))
      if (transport === 'console') {
        return Mailer.layerConsole
      }
      const host = yield* Config.String('SMTP_HOST')
      return Mailer.layerSmtp(host)
    }),
  )
}

const sendWelcome = Mailer.use((mailer) =>
  mailer.send('ada@example.com', 'Welcome!'),
)

// A small helper that runs the same program against a given set of values.
const runWith = (values: Record<string, string>) =>
  sendWelcome.pipe(
    Effect.provide(
      Mailer.layer.pipe(
        Layer.provide(ConfigProvider.layer(ConfigProvider.fromUnknown(values))),
      ),
    ),
    Effect.catchTag('ConfigError', (error) => Effect.succeed(error.message)),
  )

export const program = Effect.gen(function* () {
  // Nothing set: the default picks the console mailer.
  yield* Console.log(yield* runWith({}))

  // Production settings pick SMTP and pass the host into its layer.
  yield* Console.log(
    yield* runWith({ MAIL_TRANSPORT: 'smtp', SMTP_HOST: 'mail.example.com' }),
  )

  // A config error while choosing becomes an error of the layer, and so of
  // the program that provides it.
  yield* Console.log(yield* runWith({ MAIL_TRANSPORT: 'smtp' }))
})
