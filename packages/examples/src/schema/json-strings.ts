/**
 * @title Parsing JSON strings
 * @difficulty beginner
 * @summary `JSON.parse` returns `any` and trusts the text completely.
 * `Schema.fromJsonString` parses and validates in one step, and stringifies
 * on the way back out.
 */

import { Console, Effect, Schema } from 'effect'

const Settings = Schema.Struct({
  theme: Schema.Literals(['light', 'dark']),
  fontSize: Schema.Number,
})

// `fromJsonString` wraps a schema so that its encoded side is a JSON string.
const SettingsJson = Schema.fromJsonString(Settings)

export const program = Effect.gen(function* () {
  // Parse text from a file, `localStorage`, or a request body.
  const text = '{"theme":"dark","fontSize":14}'
  const settings = yield* Schema.decodeUnknownEffect(SettingsJson)(text)
  yield* Console.log(settings)

  // Encoding validates the value and stringifies it.
  yield* Console.log(
    Schema.encodeSync(SettingsJson)({ ...settings, fontSize: 16 }),
  )

  // Invalid JSON and valid JSON with the wrong shape both fail the same way,
  // as a `SchemaError`.
  const errors = yield* Effect.forEach(
    ['{"theme":', '{"theme":"blue","fontSize":14}'],
    (input) =>
      Schema.decodeUnknownEffect(SettingsJson)(input).pipe(
        Effect.as('ok'),
        Effect.catchTag('SchemaError', (error) =>
          Effect.succeed(error.message),
        ),
      ),
  )
  yield* Console.log(errors.join('\n\n'))
})
