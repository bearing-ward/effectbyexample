/**
 * @title YAML, TOML, and INI config files
 * @difficulty beginner
 * @summary Effect includes small parsers for the three common config
 * formats. Each turns text into plain JavaScript data, and a schema then
 * checks that the data has the shape your app expects.
 */

import { Console, Effect, Schema } from 'effect'
import { Ini, Toml, Yaml } from 'effect/encoding'

// The three modules are marked unstable. They only parse: there is no
// `stringify`, so they are for reading config, not writing it.

// One schema describes the config, whatever file it came from.
const ShopConfig = Schema.Struct({
  name: Schema.String,
  currencies: Schema.Array(Schema.String),
  server: Schema.Struct({ port: Schema.Int, tls: Schema.Boolean }),
})

const yamlFile = `
# shop settings
name: Corner Shop
currencies: [USD, EUR]
server:
  port: 8080
  tls: true
`

const tomlFile = `
name = "Corner Shop"
currencies = ["USD", "EUR"]

[server]
port = 8080
tls = true
`

const iniFile = `
name = Corner Shop
currencies[] = USD
currencies[] = EUR

[server]
port = 8080
tls = true
`

class ConfigSyntaxError extends Schema.TaggedError<ConfigSyntaxError>()(
  'ConfigSyntaxError',
  { message: Schema.String },
) {}

// The parsers throw a `SyntaxError` on malformed text. Wrap them with
// `Effect.try` to get a typed failure instead.
const parse = (parser: (text: string) => unknown, text: string) =>
  Effect.try({
    try: () => parser(text),
    catch: (error) => new ConfigSyntaxError({ message: String(error) }),
  })

export const program = Effect.gen(function* () {
  // YAML and TOML both have numbers and booleans, so the same schema
  // decodes either file to the same value.
  const fromYaml = yield* parse(Yaml.parse, yamlFile)
  const fromToml = yield* parse(Toml.parse, tomlFile)
  const yamlConfig = yield* Schema.decodeUnknownEffect(ShopConfig)(fromYaml)
  const tomlConfig = yield* Schema.decodeUnknownEffect(ShopConfig)(fromToml)
  yield* Console.log(yamlConfig)
  yield* Console.log(JSON.stringify(yamlConfig) === JSON.stringify(tomlConfig))

  // INI is looser. Only `true`, `false`, and `null` are decoded; every other
  // value stays a string, so the port arrives as `"8080"`.
  const fromIni = yield* parse(Ini.parse, iniFile)
  yield* Console.log(fromIni)
  const rejected = yield* Schema.decodeUnknownEffect(ShopConfig)(fromIni).pipe(
    Effect.as('decoded'),
    Effect.catchTag('SchemaError', (error) => Effect.succeed(error.message)),
  )
  yield* Console.log(rejected)

  // Give the INI file a schema that converts the port from a string.
  const IniShopConfig = Schema.Struct({
    ...ShopConfig.fields,
    server: Schema.Struct({
      port: Schema.FiniteFromString.check(Schema.isInt()),
      tls: Schema.Boolean,
    }),
  })
  yield* Console.log(yield* Schema.decodeUnknownEffect(IniShopConfig)(fromIni))

  // Malformed text fails with the typed error and the parser's message.
  const broken = yield* parse(Toml.parse, 'port = = 8080').pipe(
    Effect.catchTag('ConfigSyntaxError', (error) =>
      Effect.succeed(error.message),
    ),
  )
  yield* Console.log(broken)
})
