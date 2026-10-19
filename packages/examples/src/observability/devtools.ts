/**
 * @title Watching a program with DevTools
 * @difficulty advanced
 * @summary The Effect DevTools extension for VS Code shows spans and metrics
 * from a running program. `DevTools.layer` connects to it over a
 * WebSocket. This page connects the client to a `DevToolsServer` through an
 * in-memory socket instead, so you can see every message it sends. The
 * DevTools and socket modules are marked unstable.
 */

import { Console, Deferred, Effect, Layer, Metric, Queue, Schema } from 'effect'
import {
  DevTools,
  DevToolsClient,
  DevToolsSchema,
  DevToolsServer,
} from 'effect/devtools'
import { NetAddress } from 'effect/net'
import { Socket, SocketServer } from 'effect/socket'

// In an app you add one layer, and the extension, which listens on
// `ws://localhost:34437`, starts showing your spans and metrics.
/* program.pipe(Effect.provide(DevTools.layer())) */

// `DevTools.layer` is `DevTools.layerSocket` over a WebSocket.
// `layerSocket` accepts any `Socket`, which is what this page relies on.
// This one is one end of an in-memory connection: it reads lines from
// `inbox` and writes lines to `outbox`. Two of them, crossed over, make a
// client and a server. When the reading side shuts down, a pending read
// fails with a close error, as it would on a real socket.
const memorySocket = (
  inbox: Queue.Queue<string>,
  outbox: Queue.Queue<string>,
) =>
  Socket.make({
    reader: Effect.gen(function* () {
      const closed = yield* Deferred.make<never, Socket.SocketError>()
      const reason = new Socket.SocketCloseError({ code: 1000 })
      yield* Effect.addFinalizer(() =>
        Deferred.fail(closed, new Socket.SocketError({ reason })),
      )
      return {
        pull: Queue.take(inbox).pipe(
          Effect.map((line) => [line] as const),
          Effect.raceFirst(Deferred.await(closed)),
        ),
        upgrade: () => Effect.void,
      }
    }),
    writer: Effect.succeed({
      write: (chunk) =>
        typeof chunk === 'string' ? Queue.offer(outbox, chunk) : Effect.void,
      writeAll: (chunks) =>
        Queue.offerAll(
          outbox,
          chunks.filter((chunk) => typeof chunk === 'string'),
        ),
    }),
  })

// Messages the server received, in the shape `DevToolsSchema.Request`
// describes, reduced to what this page prints.
const describe = (request: DevToolsSchema.Request.WithoutPing) => {
  switch (request._tag) {
    case 'Span':
      return `span ${request.name} ${request.status._tag}`
    case 'SpanEvent':
      return `event ${request.name}`
    case 'MetricsSnapshot':
      return `metrics ${request.metrics.map((metric) => metric.id).join(',')}`
  }
}

const checkout = Effect.succeed('charged').pipe(
  Effect.withSpan('chargeCard'),
  Effect.withSpan('checkout'),
)

// Every message is a schema in `DevToolsSchema`. On the wire each one is a
// line of JSON, like the keep-alive ping the client sends every 3 seconds.
const toWire = Schema.encodeSync(
  Schema.fromJsonString(Schema.toCodecJson(DevToolsSchema.Request)),
)

export const program = Effect.gen(function* () {
  yield* Console.log(toWire({ _tag: 'Ping' }))

  const toServer = yield* Queue.unbounded<string>()
  const toClient = yield* Queue.unbounded<string>()
  const serverSocket = memorySocket(toServer, toClient)
  const clientSocket = memorySocket(toClient, toServer)
  const received = yield* Queue.unbounded<string>()

  // A `SocketServer` that accepts exactly one connection: our client.
  const server = SocketServer.SocketServer.of({
    address: NetAddress.unixPathAddress('memory'),
    run: (handler) =>
      handler(serverSocket).pipe(Effect.ignore, Effect.andThen(Effect.never)),
  })

  // `DevToolsServer.run` is the extension's side. It decodes each NDJSON
  // line and hands us a client with a queue of its messages. Asking for a
  // metrics snapshot right away also tells the client it is connected.
  yield* DevToolsServer.run((client) =>
    Effect.gen(function* () {
      yield* client.send({ _tag: 'MetricsRequest' })
      while (true) {
        const request = yield* Queue.take(client.queue)
        yield* Queue.offer(received, describe(request))
      }
    }),
  ).pipe(
    Effect.provideService(SocketServer.SocketServer, server),
    Effect.forkScoped,
  )

  // `DevToolsClient.layerTracer` wraps the current tracer so every span is
  // sent when it starts and again when it ends. `DevTools.layerSocket` is
  // this same layer under the name an app would use.
  yield* Console.log(DevTools.layerSocket === DevToolsClient.layerTracer)
  const ClientLive = DevToolsClient.layerTracer.pipe(
    Layer.provide(Layer.succeed(Socket.Socket, clientSocket)),
  )

  yield* Metric.update(Metric.counter('orders_placed'), 1)
  yield* Effect.gen(function* () {
    yield* checkout
    // Wait for the server to receive four span updates and the snapshot it
    // asked for. Spans arrive in order; the snapshot is sorted last here
    // because it may arrive before or after them.
    const messages = yield* Queue.takeN(received, 5)
    const sorted = [...messages].sort(
      (a, b) =>
        Number(a.startsWith('metrics')) - Number(b.startsWith('metrics')),
    )
    for (const message of sorted) {
      yield* Console.log(message)
    }
  }).pipe(Effect.provide(ClientLive))
}).pipe(
  Effect.scoped,
  Effect.provideServiceEffect(
    Metric.MetricRegistry,
    Effect.sync(() => new Map()),
  ),
)
