/**
 * @title Streaming NDJSON
 * @difficulty intermediate
 * @summary Newline-delimited JSON puts one JSON value per line, so a reader
 * can process records as they arrive. The `Ndjson` channels split a stream
 * of text chunks into lines, parse them, and validate each one with a schema.
 */

import { Console, Effect, Schema, Stream } from 'effect'
import { Ndjson } from 'effect/encoding'

const OrderEvent = Schema.Struct({
  orderId: Schema.String,
  status: Schema.Literals(['placed', 'paid', 'shipped']),
})

// Network reads do not respect line boundaries. These chunks split the
// second record in half and end with a blank line.
const chunks = [
  '{"orderId":"A1","status":"placed"}\n{"orderId":"A1",',
  '"status":"paid"}\n{"orderId":"B7","status":"shipped"}\n',
  '\n',
]

export const program = Effect.gen(function* () {
  // `decodeSchemaString` buffers partial lines, parses each complete line,
  // and decodes it with the schema. `Stream.pipeThroughChannel` plugs the
  // channel into the stream. `ignoreEmptyLines` skips the trailing blank
  // line instead of failing on it.
  const events = yield* Stream.fromIterable(chunks).pipe(
    Stream.pipeThroughChannel(
      Ndjson.decodeSchemaString(OrderEvent)({ ignoreEmptyLines: true }),
    ),
    Stream.runCollect,
  )
  yield* Console.log(events)

  // The reverse direction encodes each value through the schema and emits
  // one line per value, ready to write to a file or a response body.
  const lines = yield* Stream.fromIterable(events).pipe(
    Stream.filter((event) => event.status !== 'placed'),
    Stream.pipeThroughChannel(Ndjson.encodeSchemaString(OrderEvent)()),
    Stream.runCollect,
  )
  yield* Console.log(lines.join(''))

  // A line that is not JSON fails the stream with an `NdjsonError`, which
  // `Stream.catchTag` can recover from. `kind` is `"Unpack"` for decoding
  // failures and `"Pack"` for encoding failures.
  const recovered = yield* Stream.make('oops, not json\n').pipe(
    Stream.pipeThroughChannel(Ndjson.decodeString()),
    Stream.catchTag('NdjsonError', (error) =>
      Stream.succeed({ failed: error.kind }),
    ),
    Stream.runCollect,
  )
  yield* Console.log(recovered)

  // A line that is valid JSON but the wrong shape fails with a
  // `SchemaError` instead. The path starts with the record's index in its
  // chunk.
  const invalid = yield* Stream.make('{"orderId":"D4","status":"lost"}\n').pipe(
    Stream.pipeThroughChannel(Ndjson.decodeSchemaString(OrderEvent)()),
    Stream.runCollect,
    Effect.catchTag('SchemaError', (error) => Effect.succeed(error.message)),
  )
  yield* Console.log(invalid)
})
