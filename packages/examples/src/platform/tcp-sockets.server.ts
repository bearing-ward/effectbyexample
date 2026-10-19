/**
 * @title TCP sockets
 * @difficulty advanced
 * @summary A `SocketServer` accepts connections and hands each one to your
 * handler as a `Socket`. A `Socket` is a pair of scoped resources: a reader
 * to pull incoming bytes and a writer to send them. Here a server and a
 * client talk to each other in one program.
 */

// The socket modules are marked unstable. `@effect/platform-node` provides
// TCP implementations of both.
import { NodeSocket, NodeSocketServer } from '@effect/platform-node'
import { Console, Effect, Fiber, Stream } from 'effect'
import { NetAddress } from 'effect/net'
import { Socket, SocketServer } from 'effect/socket'

// The handler for one connection: read lines, answer each in upper case.
// `Socket.toStream` turns the reader into a byte stream. When the client
// disconnects, the stream fails with a `SocketCloseError` reason. Here that
// is the normal end of the conversation, so the handler catches it.
const shout = (socket: Socket.Socket) =>
  Effect.gen(function* () {
    const writer = yield* socket.writer
    yield* Socket.toStream(socket).pipe(
      Stream.decodeText,
      Stream.splitLines,
      Stream.runForEach((line) => writer.write(`${line.toUpperCase()}\n`)),
    )
  }).pipe(
    Effect.catchReason('SocketError', 'SocketCloseError', () => Effect.void),
    Effect.scoped,
  )

export const program = Effect.gen(function* () {
  // Port 0 asks the operating system for any free port. The server's
  // `address` tells us which one it picked.
  const server = yield* SocketServer.SocketServer
  const address = server.address
  if (!NetAddress.isInetAddress(address)) return
  yield* Console.log(address._tag, NetAddress.formatIp(address.address))

  // `run` accepts connections forever, so it runs in a background fiber that
  // is interrupted when the program's scope closes.
  yield* server.run(shout).pipe(Effect.forkScoped)

  // The client gets the same `Socket` interface. The connection opens when
  // the reader is acquired, and writes wait until it is open, so start
  // reading first, in a background fiber.
  const replies = yield* Effect.gen(function* () {
    const socket = yield* NodeSocket.makeNet({
      host: '127.0.0.1',
      port: address.port,
    })
    // TCP is a byte stream, not a message stream: two writes can arrive as
    // one chunk or as three. Splitting lines recovers the messages.
    const reading = yield* Socket.toStream(socket).pipe(
      Stream.decodeText,
      Stream.splitLines,
      Stream.take(2),
      Stream.runCollect,
      Effect.forkScoped,
    )
    const writer = yield* socket.writer
    yield* writer.write('hello\n')
    yield* writer.write('effect sockets\n')
    return yield* Fiber.join(reading)
  }).pipe(Effect.scoped)
  yield* Console.log(replies)

  // Connecting to a port nobody listens on fails with a `SocketError` as
  // soon as the reader tries to open the connection.
  const refused = yield* NodeSocket.makeNet({
    host: '127.0.0.1',
    port: 1,
  }).pipe(
    Effect.flatMap((socket) => Stream.runDrain(Socket.toStream(socket))),
    Effect.flip,
  )
  yield* Console.log(refused._tag, refused.reason._tag)
}).pipe(
  Effect.scoped,
  Effect.provide(NodeSocketServer.layer({ host: '127.0.0.1', port: 0 })),
)
