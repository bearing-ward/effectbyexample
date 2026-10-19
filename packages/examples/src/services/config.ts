/**
 * @title Reading configuration
 * @difficulty beginner
 * @summary `Config` describes the settings a program needs and their types.
 * A `ConfigProvider` supplies the raw values. By default that is the
 * environment, but you can swap in any source, such as a fixed object in a
 * test.
 */

import { Config, ConfigProvider, Console, Effect, Redacted } from 'effect'

// Each config names a key and a type. `Config.all` groups them into one
// typed object. A default makes a key optional, and `Redacted` hides a
// secret so it never shows up in logs by accident.
const ServerConfig = Config.all({
  host: Config.String('HOST'),
  port: Config.Port('PORT'),
  debug: Config.Boolean('DEBUG').pipe(Config.withDefault(false)),
  apiKey: Config.Redacted('API_KEY'),
})

// A `Config` is also an Effect, so you can `yield*` it. Its error type is
// `ConfigError`. The value comes from whatever provider is in scope.
const describeServer = Effect.gen(function* () {
  const config = yield* ServerConfig
  yield* Console.log(`listening on ${config.host}:${config.port}`)
  yield* Console.log('debug:', config.debug)
  yield* Console.log('api key:', String(config.apiKey))
  yield* Console.log('key length:', Redacted.value(config.apiKey).length)
})

export const program = Effect.gen(function* () {
  // `ConfigProvider.fromUnknown` reads from a plain object. Numbers and
  // booleans arrive as strings, as they would from the environment, and
  // `Config.Port` parses and checks them.
  const provider = ConfigProvider.fromUnknown({
    HOST: 'localhost',
    PORT: '8080',
    API_KEY: 'sk_live_123',
  })

  // `ConfigProvider.layer` installs the provider for everything below it.
  yield* describeServer.pipe(Effect.provide(ConfigProvider.layer(provider)))

  // A value that does not parse fails with a `ConfigError` that points at
  // the key. A missing key without a default fails the same way.
  const broken = ConfigProvider.fromUnknown({
    HOST: 'localhost',
    PORT: 'http',
    API_KEY: 'sk_live_123',
  })
  const message = yield* describeServer.pipe(
    Effect.provide(ConfigProvider.layer(broken)),
    Effect.as('started'),
    Effect.catchTag('ConfigError', (error) => Effect.succeed(error.message)),
  )
  yield* Console.log(message)

  // `Config.nested` reads keys under a prefix, which suits structured
  // sources such as parsed JSON.
  const nested = ConfigProvider.fromUnknown({
    database: { url: 'postgres://db/orders', poolSize: 4 },
  })
  const database = yield* Config.all({
    url: Config.String('url'),
    poolSize: Config.Int('poolSize'),
  }).pipe(Config.nested('database'), (config) => config.parse(nested))
  yield* Console.log(database)
})
