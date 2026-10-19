/**
 * @title Default values
 * @difficulty intermediate
 * @summary Fill in missing values in one place, either when decoding input or
 * when constructing a value in code.
 */

import { Console, Effect, Schema } from 'effect'

const ServerConfig = Schema.Struct({
  host: Schema.String,

  // `withDecodingDefault` supplies a value when the key is missing or
  // `undefined` in the input. The field is optional in `Encoded` but always
  // present in `Type`.
  port: Schema.Number.pipe(
    Schema.optional,
    Schema.withDecodingDefault(Effect.succeed(8080)),
  ),
  logLevel: Schema.Literals(['debug', 'info', 'error']).pipe(
    Schema.optional,
    Schema.withDecodingDefault(Effect.succeed('info' as const)),
  ),
})

// `withConstructorDefault` instead fills a value when you build one in code
// with `make`. The default is an Effect, so it can read the clock, a random
// number, or anything else.
const Draft = Schema.Struct({
  title: Schema.String,
  tags: Schema.Array(Schema.String).pipe(
    Schema.withConstructorDefault(Effect.succeed([])),
  ),
})

export const program = Effect.gen(function* () {
  const decode = Schema.decodeUnknownSync(ServerConfig)
  yield* Console.log(decode({ host: 'localhost' }))
  yield* Console.log(
    decode({ host: 'example.com', port: 443, logLevel: 'error' }),
  )

  yield* Console.log(Draft.make({ title: 'Hello' }))
  yield* Console.log(Draft.make({ title: 'Tagged', tags: ['effect'] }))
})
