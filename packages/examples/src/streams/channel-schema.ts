/**
 * @title Validating streams with ChannelSchema
 * @difficulty advanced
 * @summary `ChannelSchema` turns a `Schema` into a channel that decodes or
 * encodes every value passing through a stream. It is how Effect's own NDJSON
 * and server-sent events decoders validate their output, and you can use it
 * at any boundary where untyped data enters or leaves a stream.
 */

import { ChannelSchema, Console, Effect, Schema, Stream } from 'effect'

// `ChannelSchema` is marked unstable, so its API may change in a minor
// release.
//
// An order event as it travels over the wire: the amount is a string of
// cents, and the schema turns it into a number for our code.
const OrderPlaced = Schema.Struct({
  orderId: Schema.String,
  cents: Schema.FiniteFromString,
})

// Imagine these came from a message queue as parsed JSON. Their type is
// `unknown`: nothing has checked them yet.
const incoming: Array<unknown> = [
  { orderId: 'o1', cents: '1200' },
  { orderId: 'o2', cents: '450' },
]

export const program = Effect.gen(function* () {
  // `decodeUnknown(schema)()` builds a channel that reads `unknown` values
  // and emits decoded `OrderPlaced` values. `pipeThroughChannel` puts it in
  // the stream. The result is a typed stream that can fail with
  // `SchemaError`.
  const orders = Stream.fromIterable(incoming).pipe(
    Stream.pipeThroughChannel(ChannelSchema.decodeUnknown(OrderPlaced)()),
  )
  yield* Console.log(yield* Stream.runCollect(orders))

  // Bad input fails the stream with a `SchemaError`. The channel decodes a
  // whole batch at once, so values from earlier batches get through, but
  // nothing from the batch that held the bad value does. Here each `make`
  // call becomes its own batch, so `o3` is accepted and `o4` is not. The
  // error path `[1]["cents"]` points at the second value of the batch.
  const withBadEvent = Stream.make({ orderId: 'o3', cents: '99' }).pipe(
    Stream.concat(
      Stream.make(
        { orderId: 'o4', cents: '10' },
        { orderId: 'o5', cents: 'ten' },
      ),
    ),
    Stream.pipeThroughChannel(ChannelSchema.decodeUnknown(OrderPlaced)()),
    Stream.tap((order) => Console.log(`  accepted ${order.orderId}`)),
    Stream.runCollect,
    Effect.catchTag('SchemaError', (error) =>
      Effect.succeed(`rejected: ${error.message}`),
    ),
  )
  yield* Console.log(yield* withBadEvent)

  // `encode(schema)()` goes the other way: typed values in, wire format out.
  // Here the numbers become strings again, ready to publish.
  const outgoing = yield* Stream.make({ orderId: 'o6', cents: 3000 }).pipe(
    Stream.pipeThroughChannel(ChannelSchema.encode(OrderPlaced)()),
    Stream.runCollect,
  )
  yield* Console.log(outgoing)
})
