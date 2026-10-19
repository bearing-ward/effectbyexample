/**
 * @title Streaming RPCs
 * @difficulty intermediate
 * @summary Some calls return many values over time: progress updates, log
 * lines, search results. Mark an RPC with `stream: true` and its handler
 * returns a `Stream`. The client gets a `Stream` back and pulls values as the
 * server produces them.
 */

import { Console, Effect, Schema, Stream } from 'effect'
import { Rpc, RpcGroup, RpcSchema, RpcTest } from 'effect/rpc'

class DeliveryLost extends Schema.TaggedError<DeliveryLost>()('DeliveryLost', {
  lastSeen: Schema.String,
}) {}

// With `stream: true`, `success` describes each element and `error` describes
// a failure that ends the stream.
const TrackParcel = Rpc.make('TrackParcel', {
  payload: { parcelId: Schema.String },
  success: Schema.String,
  error: DeliveryLost,
  stream: true,
})

const WatchCourier = Rpc.make('WatchCourier', {
  success: Schema.String,
  stream: true,
})

class ParcelRpcs extends RpcGroup.make(TrackParcel, WatchCourier) {}

// Behind the scenes `stream: true` wraps the schemas in `RpcSchema.Stream`.
// That is how the client knows to return a stream instead of one value.
const isStream = RpcSchema.isStreamSchema(TrackParcel.successSchema)

const steps = ['picked up', 'in transit', 'out for delivery', 'delivered']

const ParcelHandlers = ParcelRpcs.toLayer({
  TrackParcel: ({ parcelId }) =>
    parcelId === 'parcel-lost'
      ? Stream.make(`${parcelId}: picked up`).pipe(
          Stream.concat(Stream.fail(new DeliveryLost({ lastSeen: 'depot' }))),
        )
      : Stream.fromIterable(steps).pipe(
          Stream.map((step) => `${parcelId}: ${step}`),
        ),
  // This stream never ends on its own. It reports the courier's position
  // until the client stops listening.
  WatchCourier: () =>
    Stream.iterate(1, (stop) => stop + 1).pipe(
      Stream.map((stop) => `courier at stop ${stop}`),
      Stream.ensuring(Console.log('server: courier feed stopped')),
    ),
})

export const program = Effect.gen(function* () {
  yield* Console.log(`success schema is a stream: ${isStream}`)
  const client = yield* RpcTest.makeClient(ParcelRpcs)

  // Calling the RPC returns a `Stream`. Nothing is sent until you run it.
  yield* client
    .TrackParcel({ parcelId: 'parcel-1' })
    .pipe(Stream.runForEach((update) => Console.log(update)))

  // Taking a few elements from the endless feed ends the call early. The
  // client tells the server to stop, and the server's stream is interrupted.
  const firstTwo = yield* client
    .WatchCourier()
    .pipe(Stream.take(2), Stream.runCollect)
  yield* Console.log(firstTwo)

  // A typed failure arrives after the elements sent before it, and ends the
  // stream on the client with the same error.
  yield* client.TrackParcel({ parcelId: 'parcel-lost' }).pipe(
    Stream.runForEach((update) => Console.log(update)),
    Effect.catchTag('DeliveryLost', (error) =>
      Console.log(`lost, last seen at the ${error.lastSeen}`),
    ),
  )
}).pipe(Effect.provide(ParcelHandlers), Effect.scoped)
