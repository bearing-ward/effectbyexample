/**
 * @title Compact binary encoding with SchemaBinary
 * @difficulty advanced
 * @summary JSON repeats every key in every message. `SchemaBinary` derives a
 * compact binary codec from a schema instead, for sockets, queues, or
 * storage where size matters.
 */

import { Console, Effect, Schema, Stream } from 'effect'
import { SchemaBinary } from 'effect/encoding'

// The module is marked unstable.
const Reading = Schema.Struct({
  sensor: Schema.String,
  celsius: Schema.Number,
  ok: Schema.Boolean,
})

const reading = { sensor: 'kitchen', celsius: 21.5, ok: true }

export const program = Effect.gen(function* () {
  // `toCodec` returns an ordinary schema whose encoded side is a
  // `Uint8Array`, so the usual `encode` and `decode` functions work with it.
  // Decoded keys come back in wire order, which can differ from the schema's
  // order.
  const codec = SchemaBinary.toCodec(Reading)
  const bytes = Schema.encodeSync(codec)(reading)
  yield* Console.log('binary:', bytes.length, 'bytes')
  yield* Console.log('json:', JSON.stringify(reading).length, 'bytes')
  yield* Console.log(Schema.decodeSync(codec)(bytes))

  // The default format tolerates schema changes. A newer reader that added
  // an optional field still decodes old messages, and an old reader skips
  // the field it does not know.
  const ReadingV2 = Schema.Struct({
    ...Reading.fields,
    humidity: Schema.optionalKey(Schema.Number),
  })
  const v2 = SchemaBinary.toCodec(ReadingV2)
  yield* Console.log(Schema.decodeSync(v2)(bytes))
  yield* Console.log(
    Schema.decodeSync(codec)(
      Schema.encodeSync(v2)({ ...reading, humidity: 40 }),
    ),
  )

  // `fingerprint: true` drops the field ids for smaller frames, but both
  // sides must use exactly the same schema. A mismatch is rejected.
  const strict = SchemaBinary.toCodec(Reading, { fingerprint: true })
  yield* Console.log(
    'fingerprint:',
    Schema.encodeSync(strict)(reading).length,
    'bytes',
  )
  const mismatch = Schema.encodeSync(
    SchemaBinary.toCodec(ReadingV2, { fingerprint: true }),
  )(reading)
  yield* Console.log(Schema.decodeOption(strict)(mismatch)._tag)

  // For streams, the `encode` and `decode` channels handle framing. Here two
  // readings are encoded, then cut into chunks that ignore frame boundaries,
  // as a socket might deliver them. The decoder reassembles both.
  const frames = yield* Stream.make(
    { sensor: 'hall', celsius: 19, ok: true },
    { sensor: 'attic', celsius: 31, ok: false },
  ).pipe(
    Stream.pipeThroughChannel(SchemaBinary.encode(Reading)()),
    Stream.runCollect,
  )
  const wire = frames[0]!
  const received = yield* Stream.make(
    wire.slice(0, 5),
    wire.slice(5, 23),
    wire.slice(23),
  ).pipe(
    Stream.pipeThroughChannel(SchemaBinary.decode(Reading)()),
    Stream.runCollect,
  )
  yield* Console.log(received)
})
