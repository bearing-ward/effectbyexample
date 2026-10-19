/**
 * @title Sending logs, metrics and traces together
 * @difficulty advanced
 * @summary `Otlp.layerJson` sets up the three OTLP exporters at once from a
 * single collector address: `OtlpLogger` for log records, `OtlpMetrics` for
 * metric data points, and `OtlpTracer` for spans. When the layer shuts
 * down, each exporter sends what it has buffered. The OTLP modules are
 * marked unstable.
 */

import { Console, Effect, Layer, Metric } from 'effect'
import { HttpClient, HttpClientResponse, HttpServerResponse } from 'effect/http'
import type { HttpClientRequest } from 'effect/http'
import {
  Otlp,
  OtlpLogger,
  OtlpMetrics,
  OtlpSerialization,
} from 'effect/observability'

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

const ordersPlaced = Metric.counter('orders_placed', { incremental: true })

const placeOrder = Effect.gen(function* () {
  yield* Effect.logInfo('order placed').pipe(
    Effect.annotateLogs('orderId', 'ord-1001'),
  )
  yield* Metric.update(ordersPlaced, 1)
}).pipe(Effect.withSpan('placeOrder'))

// The body of an OTLP request, decoded for printing.
const bodyOf = (request: HttpClientRequest.HttpClientRequest) =>
  request.body._tag === 'Uint8Array' ? JSON.parse(request.body.text ?? '') : {}

export const program = Effect.gen(function* () {
  const sent: Array<HttpClientRequest.HttpClientRequest> = []

  // `baseUrl` is the collector. Each signal goes to its standard path below
  // it. A service name is required, here or in the `OTEL_SERVICE_NAME`
  // config value. `loggerMergeWithExisting: false` makes OTLP the only
  // logger, so nothing is printed to the console as well.
  const ObservabilityLive = Otlp.layerJson({
    baseUrl: 'https://collector.example.com',
    resource: { serviceName: 'checkout' },
    loggerMergeWithExisting: false,
  }).pipe(
    Layer.provide(Layer.succeed(HttpClient.HttpClient, recordingClient(sent))),
  )

  // Nothing is sent while the program runs: every exporter is still
  // waiting for its next interval. Leaving `Effect.provide` closes the
  // layer, and each exporter flushes on the way out.
  yield* placeOrder.pipe(
    Effect.andThen(Console.log('sent while running:', sent.length)),
    Effect.provide(ObservabilityLive),
  )
  const byUrl = [...sent].sort((a, b) => a.url.localeCompare(b.url))
  yield* Console.log(byUrl.map((request) => request.url))
  const [logsRequest, metricsRequest, tracesRequest] = byUrl.map(bodyOf)

  // `OtlpLogger.LogsData` is the shape of a logs body. Annotations become
  // attributes, next to the fiber ID that wrote the entry.
  const logs: OtlpLogger.LogsData = logsRequest
  const [record] = logs.resourceLogs[0]?.scopeLogs[0]?.logRecords ?? []
  yield* Console.log('log:', record?.severityText, record?.body, {
    attributes: record?.attributes?.map(({ key }) => key),
  })

  // The record also carries the IDs of the span it was logged in, so a
  // tracing backend can show the log line inside the trace.
  const span = tracesRequest.resourceSpans[0].scopeSpans[0].spans[0]
  yield* Console.log('span:', span.name, {
    logInSpan: record?.spanId === span.spanId,
  })

  // `OtlpMetrics.MetricsData` is the shape of a metrics body. An
  // incremental counter is sent as a monotonic sum.
  const metrics: OtlpMetrics.MetricsData = metricsRequest
  const [metric] = metrics.resourceMetrics[0]?.scopeMetrics[0]?.metrics ?? []
  yield* Console.log('metric:', metric?.name, {
    isMonotonic: metric?.sum?.isMonotonic,
    value: metric?.sum?.dataPoints[0]?.asDouble,
  })

  // `Otlp.layerJson` is `Otlp.layer` with `OtlpSerialization.layerJson`.
  // Provide `OtlpSerialization.layerProtobuf` instead and the same
  // exporters send the smaller binary protobuf encoding.
  const binary: Array<HttpClientRequest.HttpClientRequest> = []
  yield* Effect.log('protobuf this time').pipe(
    Effect.withSpan('reprint'),
    Effect.provide(
      Otlp.layer({
        baseUrl: 'https://collector.example.com',
        resource: { serviceName: 'checkout' },
        loggerMergeWithExisting: false,
      }).pipe(
        Layer.provide(OtlpSerialization.layerProtobuf),
        Layer.provide(
          Layer.succeed(HttpClient.HttpClient, recordingClient(binary)),
        ),
      ),
    ),
  )
  binary.sort((a, b) => a.url.localeCompare(b.url))
  for (const request of binary) {
    yield* Console.log(request.url, request.headers['content-type'])
  }
}).pipe(
  Effect.provideServiceEffect(
    Metric.MetricRegistry,
    Effect.sync(() => new Map()),
  ),
)
