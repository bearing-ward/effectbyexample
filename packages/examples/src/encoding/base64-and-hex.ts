/**
 * @title Base64, Base64Url, and hex
 * @difficulty beginner
 * @summary Turn bytes into text and back for headers, URLs, and logs.
 * Encoding always succeeds. Decoding returns a `Result` that fails with an
 * `EncodingError` when the text is malformed, so bad input never throws.
 */

import { Console, Effect, Result } from 'effect'
import { Base64, Base64Url, EncodingError, Hex } from 'effect/encoding'

export const program = Effect.gen(function* () {
  // All three accept a string (encoded as UTF-8) or a `Uint8Array`.
  const credentials = 'ada:s3cret?>!'

  // Standard Base64 uses `+` and `/` and pads with `=`, as in an HTTP
  // `Authorization: Basic` header.
  yield* Console.log(Base64.encode(credentials))

  // Base64Url swaps in `-` and `_` and drops the padding, so the result is
  // safe in a URL or a JWT without escaping.
  yield* Console.log(Base64Url.encode(credentials))

  // Hex is lowercase and two characters per byte, handy for checksums.
  yield* Console.log(Hex.encode(new Uint8Array([0, 15, 255])))

  // Decoding returns a `Result`. `decodeString` decodes the bytes back to
  // UTF-8 text; `decode` gives you the raw `Uint8Array`, spread into an
  // array here for display.
  yield* Console.log(Base64.decodeString('YWRhOnMzY3JldD8+IQ=='))
  yield* Console.log(
    Hex.decode('000fff').pipe(Result.map((bytes) => [...bytes])),
  )

  // Malformed input gives a failed `Result` holding an `EncodingError`. It
  // records which module failed, the direction, the input, and a message.
  const broken = Base64Url.decode('not*base64')
  if (Result.isFailure(broken)) {
    const { module, kind, input, message } = broken.failure
    yield* Console.log({ module, kind, input, message })
    yield* Console.log(EncodingError.isEncodingError(broken.failure))
  }

  // `Effect.fromResult` moves the error into the Effect error channel, where
  // `catchTag` can handle it like any other typed failure.
  const token = yield* Effect.fromResult(Hex.decodeString('not hex')).pipe(
    Effect.catchTag('EncodingError', (error) =>
      Effect.succeed(`rejected: ${error.message}`),
    ),
  )
  yield* Console.log(token)
})
