/**
 * @title Your own RPCs on a sync connection
 * @difficulty advanced
 * @summary A sync connection keeps state about the device on the other end:
 * which identities signed in, and which large writes are still arriving in
 * chunks. RPCs of your own, served next to the event log's, can require the
 * same sign-in and read that state.
 */

import { Console, Context, Effect, Layer, Queue, Schema, Stream } from 'effect'
import {
  EventJournal,
  EventLog,
  EventLogEncryption,
  EventLogMessage,
  EventLogRemote,
  EventLogServer,
  EventLogServerEncrypted,
} from 'effect/eventlog'
import { Rpc, RpcGroup, RpcTest } from 'effect/rpc'

// One extra RPC: how is my connection doing? Marking it with the
// `EventLogAuthentication` middleware means only signed-in connections may
// call it. The middleware also provides the caller's `EventLog.Identity` to
// the handler, though this one only needs the connection.
class UploadRpcs extends RpcGroup.make(
  Rpc.make('Uploads.Status', {
    success: Schema.Struct({
      signedIn: Schema.Number,
      pendingBytes: Schema.Array(Schema.Number),
    }),
    error: EventLogMessage.EventLogProtocolError,
  }).middleware(EventLogMessage.EventLogAuthentication),
) {}
const AppRpcs = EventLogMessage.EventLogRemoteRpcs.merge(UploadRpcs)

// After sign-in the server annotates the connection. `AuthenticatedIdentities`
// holds the public keys that signed in on it. `ChunkedMessageState` holds the
// parts of chunked writes received so far, keyed by message id.
const UploadHandlers = UploadRpcs.toLayer({
  'Uploads.Status': (_, { client }) =>
    Effect.succeed({
      signedIn:
        Context.getOrUndefined(
          client.annotations,
          EventLogServer.AuthenticatedIdentities,
        )?.size ?? 0,
      pendingBytes: [
        ...Context.get(
          client.annotations,
          EventLogServer.ChunkedMessageState,
        ).values(),
      ].map((message) => message.bytes),
    }),
})

// The event log handlers report the size of each write they receive.
// `layerRpcHandlers` brings `EventLogServer.layerAuthMiddleware`, the layer
// that turns a signed-in connection into an `EventLog.Identity` and refuses
// the rest. We list it as well, because our RPCs depend on it too.
const makeServer = (received: Queue.Queue<number>) =>
  Layer.unwrap(
    Effect.map(EventLogServerEncrypted.makeStorageMemory, (storage) =>
      Layer.mergeAll(
        EventLogServer.layerRpcHandlers({
          remoteId: EventJournal.makeRemoteIdUnsafe(),
          getOrCreateSessionAuthBinding: storage.getOrCreateSessionAuthBinding,
          onWrite: (data) => Queue.offer(received, data.byteLength),
          changes: () => Stream.never,
        }),
        UploadHandlers,
        EventLogServer.layerAuthMiddleware,
      ),
    ),
  )

export const program = Effect.gen(function* () {
  const received = yield* Queue.unbounded<number>()
  yield* Effect.gen(function* () {
    const client = yield* RpcTest.makeClient(AppRpcs)
    const status = client['Uploads.Status']()

    // Before signing in, the middleware refuses the call.
    const refused = yield* Effect.flip(status)
    yield* Console.log(refused.code, refused.message)

    // `EventLogRemote` signs in on this connection the first time it needs
    // to. `whenAuthenticated` runs an effect after that.
    const remote = yield* EventLogRemote.makeEncrypted.pipe(
      Effect.provideService(EventLogRemote.EventLogRemoteClient, client),
    )
    yield* Console.log('signed in:', yield* remote.whenAuthenticated(status))

    // Writes larger than `ChunkedMessage.chunkSize` (512,000 bytes) travel
    // in parts. Send the first two parts of a 1.2 MB write by hand and ask
    // again: the server holds 1,024,000 bytes for that message.
    const parts = EventLogMessage.ChunkedMessage.split(
      0,
      new Uint8Array(1_200_000),
    )
    for (const part of parts.slice(0, 2)) {
      yield* client['EventLog.WriteChunked'](part)
    }
    yield* Console.log('mid-upload:', yield* status)

    // The last part completes it. The server joins the parts, hands one
    // write to `onWrite`, and forgets the parts.
    yield* client['EventLog.WriteChunked'](parts[2]!)
    yield* Console.log('received one write of', yield* Queue.take(received))
    yield* Console.log('after upload:', yield* status)
  }).pipe(
    Effect.provide(makeServer(received)),
    Effect.provide(Layer.effect(EventLog.Identity, EventLog.makeIdentity)),
    Effect.provide(EventLog.layerRegistry),
  )
}).pipe(Effect.scoped, Effect.provide(EventLogEncryption.layerSubtle))
