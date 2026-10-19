/**
 * @title Propagating trace context
 * @difficulty advanced
 * @summary When one service calls another, the trace should continue across
 * the hop. The HTTP client writes the current span into `traceparent` and
 * `b3` headers, and the server reads them with `HttpTraceContext` and opens
 * its request span as a child, so both sides land in one trace.
 */

import { Console, Effect, Layer, Option, Tracer } from 'effect'
import {
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  HttpTraceContext,
} from 'effect/http'

// Effect's default tracer exports nowhere, so the server skips its request
// span under it. A real tracer, such as OpenTelemetry's, turns those spans
// on. This stand-in records every span it starts.
const spans: Array<Tracer.NativeSpan> = []
const RecordingTracer = Tracer.make({
  span: (options) => {
    const span = new Tracer.NativeSpan(options)
    spans.push(span)
    return span
  },
})

// IDs are normally random. A fixed upstream span keeps the output stable:
// everything below joins its trace.
const upstream = Tracer.externalSpan({
  traceId: '4bf92f3577b34da6a3ce929d0e0e4736',
  spanId: '00f067aa0ba902b7',
})

// The inventory service reports the trace it was called from.
// `fromHeaders` tries `traceparent`, then `b3`, then `x-b3-*` headers.
const StockRoute = HttpRouter.add('GET', '/stock', (request) =>
  HttpServerResponse.json({
    incomingTrace: Option.getOrNull(
      Option.map(
        HttpTraceContext.fromHeaders(request.headers),
        (s) => s.traceId,
      ),
    ),
  }),
).pipe(
  Layer.provide(HttpServer.layerServices),
  // The server needs the tracer too, to open its own request spans.
  Layer.provideMerge(Layer.succeed(Tracer.Tracer, RecordingTracer)),
)

const InMemoryClient = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const { handler } = yield* Effect.acquireRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(StockRoute, { disableLogger: true }),
      ),
      ({ dispose }) => Effect.promise(dispose),
    )
    return HttpClient.make((request) =>
      HttpServerRequest.toWeb(
        HttpServerRequest.fromClientRequest(request),
      ).pipe(
        Effect.flatMap((web) => Effect.promise(() => handler(web))),
        Effect.map((web) => HttpClientResponse.fromWeb(request, web)),
        Effect.orDie,
      ),
    )
  }),
)

export const program = Effect.gen(function* () {
  const client = yield* HttpClient.HttpClient
  const checkStock = client.get('http://inventory.test/stock').pipe(
    Effect.flatMap((response) => response.json),
    Effect.withSpan('checkout'),
    Effect.withParentSpan(upstream),
  )

  // Inside a span, the client adds the trace headers by itself.
  yield* Console.log(yield* checkStock)

  // Each span records its parent. The server's parent is an external span
  // decoded from the headers, carrying the client span's ID. So the trace
  // reads as a chain: `checkout`, the client request, the server request.
  const describe = (parent: Tracer.AnySpan | undefined) => {
    if (parent === undefined) return 'none'
    if (parent._tag === 'Span') return parent.name
    const local = spans.find((span) => span.spanId === parent.spanId)
    return local ? `${local.kind} span, via headers` : 'upstream'
  }
  for (const span of spans) {
    yield* Console.log(
      `${span.kind} ${span.name}, parent: ${describe(Option.getOrUndefined(span.parent))}, trace ${span.traceId.slice(0, 8)}`,
    )
  }

  // Some targets must not see your trace IDs, such as third-party APIs.
  // `TracerPropagationEnabled` leaves the headers off, and the server sees
  // no incoming trace.
  yield* Console.log(
    yield* checkStock.pipe(
      Effect.provideService(HttpClient.TracerPropagationEnabled, false),
    ),
  )

  // You can propagate by hand too, for example through a message queue.
  // `toHeaders` encodes a span, and `fromHeaders` decodes it.
  const sent = HttpTraceContext.toHeaders(spans[0]!)
  yield* Console.log(
    Object.keys(sent),
    Option.map(
      HttpTraceContext.fromHeaders(sent),
      (s) => s.spanId === spans[0]!.spanId,
    ),
  )
}).pipe(
  Effect.provide(InMemoryClient),
  Effect.provideService(Tracer.Tracer, RecordingTracer),
)
