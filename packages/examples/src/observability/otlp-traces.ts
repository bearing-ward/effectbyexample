/**
 * @title Exporting traces with OTLP
 * @difficulty advanced
 * @summary OTLP is the OpenTelemetry protocol that collectors such as Jaeger,
 * Honeycomb and Grafana accept. `OtlpTracer` turns finished spans into OTLP
 * batches and posts them over an `HttpClient`. Swapping in a client that
 * records requests shows exactly what would be sent. The OTLP modules are
 * marked unstable.
 */

import { Console, Effect, Layer } from 'effect'
import { HttpClient, HttpClientResponse, HttpServerResponse } from 'effect/http'
import type { HttpClientRequest } from 'effect/http'
import {
  OtlpExporter,
  OtlpResource,
  OtlpSerialization,
  OtlpTracer,
} from 'effect/observability'

// Every batch carries a resource: attributes that describe the service
// itself rather than one span. `OtlpResource.make` builds it, adding the
// SDK name, language and version next to the service name.
const resource = { serviceName: 'checkout', serviceVersion: '1.4.0' }
const keys = OtlpResource.make(resource).attributes.map(({ key }) => key)

// An `HttpClient` that keeps every request and answers it with an empty
// `200 OK`, in place of a real collector. No request leaves the program.
const recordingClient = (sent: Array<HttpClientRequest.HttpClientRequest>) =>
  HttpClient.make((request) =>
    Effect.sync(() => {
      sent.push(request)
      return HttpClientResponse.fromWeb(
        request,
        HttpServerResponse.toWeb(HttpServerResponse.empty()),
      )
    }),
  )

const checkout = Effect.succeed('charged').pipe(
  Effect.withSpan('chargeCard', { kind: 'client' }),
  Effect.andThen(Effect.annotateCurrentSpan('orderId', 'ord-1001')),
  Effect.withSpan('checkout', { kind: 'server' }),
)

export const program = Effect.gen(function* () {
  yield* Console.log('resource attributes:', keys)

  const sent: Array<HttpClientRequest.HttpClientRequest> = []
  // `OtlpTracer.layer` installs the tracer. It needs an `OtlpSerialization`,
  // which picks JSON or protobuf for the body, and an `HttpClient`.
  const TracingLive = OtlpTracer.layer({
    url: 'https://collector.example.com/v1/traces',
    resource,
  }).pipe(
    Layer.provide(OtlpSerialization.layerJson),
    Layer.provide(Layer.succeed(HttpClient.HttpClient, recordingClient(sent))),
  )

  yield* Effect.gen(function* () {
    yield* checkout
    // Spans are buffered and sent every few seconds. The exporter also
    // flushes when its layer shuts down. `OtlpExporter.Flusher` sends the
    // buffer now, which is useful before a serverless function returns.
    const flusher = yield* OtlpExporter.Flusher
    yield* Console.log('requests before flush:', sent.length)
    yield* flusher.flush
    yield* Console.log('requests after flush:', sent.length)
  }).pipe(Effect.provide(TracingLive))

  // The request is a plain POST with a JSON body.
  const [request] = sent
  if (request === undefined || request.body._tag !== 'Uint8Array') return
  yield* Console.log(request.method, request.url, request.body.contentType)

  // `OtlpTracer.TraceData` describes the body. Spans arrive in the order
  // they ended, children first. IDs and timestamps differ on every run, so
  // this page prints parents by name. OTLP sends enums as numbers: kind 2
  // is server and 3 is client, and status 1 means OK.
  const data: OtlpTracer.TraceData = JSON.parse(request.body.text ?? '')
  for (const { scopeSpans } of data.resourceSpans) {
    const spans = scopeSpans.flatMap((scope) => scope.spans)
    const nameOf = new Map(spans.map((span) => [span.spanId, span.name]))
    for (const span of spans) {
      yield* Console.log({
        name: span.name,
        parent: nameOf.get(span.parentSpanId ?? '') ?? 'none',
        kind: span.kind,
        status: span.status.code,
        attributes: span.attributes,
      })
    }
  }
})
