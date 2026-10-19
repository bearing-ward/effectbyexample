/**
 * @title Server-sent events
 * @difficulty intermediate
 * @summary Server-sent events (SSE) are the text format behind
 * `EventSource`: blocks of `id:`, `event:`, and `data:` lines separated by a
 * blank line. The `Sse` channels parse that format from a stream of chunks
 * and write it back out, with schemas for the payloads.
 */

import { Console, Duration, Effect, Schema, Stream } from 'effect'
import { Sse } from 'effect/encoding'

// The `Sse` module is marked unstable. This fixed input stands in for a
// response body. Chunks split an event name in half, one event spreads its
// JSON over two `data:` lines, and the server ends with a `retry:` directive.
const chunks = [
  ': connected\n\n',
  'id: 1\nevent: price\ndata: {"sku":"SKU-1","cents":1999}\n\n',
  'id: 2\nevent: pri',
  'ce\ndata: {"sku":"SKU-2",\ndata: "cents":500}\n\n',
  'data: market closing soon\n\n',
  'retry: 3000\n\n',
]

const Price = Schema.Struct({ sku: Schema.String, cents: Schema.Int })

export const program = Effect.gen(function* () {
  // `Sse.decode` emits one `Event` per block. Comments (lines starting with
  // `:`) are skipped, `data:` lines are joined with newlines, an event
  // without a name is a `"message"`, and the last `id` carries over.
  // A `retry:` directive is not an event: it fails the stream with a `Retry`
  // value telling the client how long to wait before reconnecting.
  const raw = yield* Stream.fromIterable(chunks).pipe(
    Stream.pipeThroughChannel(Sse.decode()),
    Stream.map(({ id, event, data }) => `${event} #${id}: ${data}`),
    Stream.catchTag('Retry', (retry) =>
      Stream.succeed(
        `retry in ${Duration.toMillis(retry.duration)}ms after #${retry.lastEventId}`,
      ),
    ),
    Stream.runCollect,
  )
  yield* Console.log(raw.join('\n'))

  // `decodeDataSchema` also parses each `data` field as JSON and decodes it
  // with a schema, keeping the event name and id.
  const prices = yield* Stream.fromIterable(chunks.slice(1, 4)).pipe(
    Stream.pipeThroughChannel(Sse.decodeDataSchema(Price)),
    Stream.runCollect,
  )
  yield* Console.log(prices)

  // On the server, `encodeSchema` goes the other way: values in, SSE text
  // out. This schema describes the whole event, including its JSON payload.
  const PriceEvent = Schema.Struct({
    id: Schema.optional(Schema.String),
    event: Schema.Literal('price'),
    data: Schema.fromJsonString(Price),
  })
  const body = yield* Stream.make({
    id: '3',
    event: 'price' as const,
    data: { sku: 'SKU-3', cents: 250 },
  }).pipe(
    Stream.pipeThroughChannel(Sse.encodeSchema(PriceEvent)),
    Stream.runCollect,
  )
  yield* Console.log(JSON.stringify(body.join('')))
})
