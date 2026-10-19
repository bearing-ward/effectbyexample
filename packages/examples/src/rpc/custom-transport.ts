/**
 * @title Writing a transport
 * @difficulty advanced
 * @summary HTTP, WebSockets, and workers are just protocols: a pair of
 * services that move encoded messages between a client and a server. Write
 * your own pair to run RPCs over any channel, and watch every message that
 * crosses it.
 */

import { Console, Effect, Queue, Schema, Stream } from 'effect'
import {
  Rpc,
  RpcClient,
  RpcGroup,
  RpcMessage,
  RpcSerialization,
  RpcServer,
  Utils,
} from 'effect/rpc'

class TodoRpcs extends RpcGroup.make(
  Rpc.make('AddTodo', {
    payload: { title: Schema.String },
    success: Schema.Number,
  }),
  Rpc.make('Countdown', { success: Schema.Number, stream: true }),
) {}

// `AddTodo` returns the new todo's id.
const TodoHandlers = TodoRpcs.toLayer(
  Effect.gen(function* () {
    let nextTodoId = 1
    return TodoRpcs.of({
      AddTodo: () => Effect.sync(() => nextTodoId++),
      Countdown: () => Stream.make(3, 2, 1),
    })
  }),
)

// The "wire" is two plain callbacks that carry strings. A real transport
// would write to a socket, a message port, or a queue here. Messages are
// encoded with `RpcSerialization.json`, whose parser always produces strings,
// and decoding yields untyped values, hence the casts.
const makeWire = Effect.gen(function* () {
  const serialization = RpcSerialization.json
  let toServer = (_frame: string) => Effect.void
  let toClient = (_frame: string) => Effect.void

  // `Utils.withRun` builds a server protocol: `write` hands decoded client
  // messages to the RPC server. `RpcServer.Protocol.make` is the same helper.
  const server = yield* Utils.withRun<RpcServer.Protocol['Service']>()(
    (write) => {
      const parser = serialization.makeUnsafe()
      toServer = (frame) =>
        Effect.forEach(
          parser.decode(frame) as ReadonlyArray<RpcMessage.FromClientEncoded>,
          (message) => write(0, message),
          { discard: true },
        )
      return Effect.gen(function* () {
        return {
          disconnects: yield* Queue.make<number>(),
          send: (_clientId, message) =>
            toClient(parser.encode(message) as string),
          end: () => Effect.void,
          clientIds: Effect.succeed(new Set([0])),
          initialMessage: Effect.succeedNone,
          supportsAck: true,
          supportsTransferables: false,
          supportsSpanPropagation: false,
          supportsNotifications: false,
          codecFor: serialization.codecFor,
        }
      })
    },
  )

  // `Utils.withRunClient` builds the client half the same way. Replies must
  // go back to the id the client sent with, which comes from a counter
  // shared by every RPC client in the program, so remember it.
  const client = yield* Utils.withRunClient((write) => {
    const parser = serialization.makeUnsafe()
    let clientId = 0
    toClient = (frame) =>
      Console.log(`<- ${frame}`).pipe(
        Effect.andThen(
          Effect.forEach(
            parser.decode(frame) as ReadonlyArray<RpcMessage.FromServerEncoded>,
            (message) => write(clientId, message),
            { discard: true },
          ),
        ),
      )
    return Effect.succeed({
      send: (id, message) => {
        clientId = id
        const frame = parser.encode(message) as string
        return Console.log(`-> ${frame}`).pipe(Effect.andThen(toServer(frame)))
      },
      supportsAck: true,
      supportsTransferables: false,
      codecFor: serialization.codecFor,
    })
  })

  return { server, client }
})

export const program = Effect.gen(function* () {
  const wire = yield* makeWire

  // The server runs forever, so fork it into the scope.
  yield* RpcServer.make(TodoRpcs, { disableTracing: true }).pipe(
    Effect.provideService(RpcServer.Protocol, wire.server),
    Effect.forkScoped,
  )

  // Request IDs come from a global counter by default. Our own counter keeps
  // the printed messages stable.
  let nextId = 0
  const client = yield* RpcClient.make(TodoRpcs, {
    disableTracing: true,
    generateRequestId: () => RpcMessage.RequestId(nextId++),
  }).pipe(Effect.provideService(RpcClient.Protocol, wire.client))

  yield* Console.log(
    `AddTodo returned ${yield* client.AddTodo({ title: 'Buy milk' })}`,
  )

  // A stream sends chunks. The client acknowledges each one before the
  // server sends more, which is how backpressure works across the wire.
  const counted = yield* client.Countdown().pipe(Stream.runCollect)
  yield* Console.log(`Countdown returned ${counted.join(', ')}`)
}).pipe(Effect.provide(TodoHandlers), Effect.scoped)
