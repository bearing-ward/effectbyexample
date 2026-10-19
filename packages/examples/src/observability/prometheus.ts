/**
 * @title Exposing metrics to Prometheus
 * @difficulty intermediate
 * @summary Prometheus scrapes metrics by fetching a plain-text page from your
 * service. `PrometheusMetrics.format` renders every metric in that text
 * format, and `PrometheusMetrics.layerHttp` serves it on a `/metrics` route.
 * The module is marked unstable.
 */

import { Console, Effect, Metric } from 'effect'
import { HttpClientRequest, HttpRouter, HttpServerRequest } from 'effect/http'
import { PrometheusMetrics } from 'effect/observability'

const requests = Metric.counter('http_requests', {
  description: 'Handled HTTP requests',
})
const latency = Metric.histogram('http_latency_ms', {
  description: 'Request latency in milliseconds',
  boundaries: [50, 200],
})

const handle = (route: string, status: number, ms: number) =>
  Effect.gen(function* () {
    const labels = { route, status: String(status) }
    yield* Metric.update(Metric.withAttributes(requests, labels), 1)
    yield* Metric.update(latency, ms)
  })

export const program = Effect.gen(function* () {
  yield* handle('/orders', 200, 35)
  yield* handle('/orders', 200, 120)
  yield* handle('/orders', 500, 900)

  // `format` reads the same snapshot as `Metric.snapshot` and renders it.
  // The description becomes `# HELP`, attributes become labels, and a
  // histogram becomes `_bucket`, `_sum` and `_count` lines, with a final
  // `+Inf` bucket that counts everything. `prefix` namespaces every name.
  const text = yield* PrometheusMetrics.format({ prefix: 'shop' })
  yield* Console.log(text.trimEnd())

  // In a server, `layerHttp` adds a `GET /metrics` route to an `HttpRouter`.
  // `toHttpEffect` builds the router into one effect that answers the
  // current `HttpServerRequest`, so this page can call the route without
  // opening a port.
  const app = yield* HttpRouter.toHttpEffect(
    PrometheusMetrics.layerHttp({ path: '/metrics', prefix: 'shop' }),
  )
  const scrape = HttpServerRequest.fromClientRequest(
    HttpClientRequest.get('http://shop.local/metrics'),
  )
  const response = yield* app.pipe(
    Effect.provideService(HttpServerRequest.HttpServerRequest, scrape),
  )
  yield* Console.log(response.status, response.headers['content-type'])
  if (response.body._tag === 'Uint8Array') {
    const body = response.body.text
    yield* Console.log(body === text ? 'same text as format' : body)
  }
}).pipe(
  Effect.scoped,
  Effect.provideServiceEffect(
    Metric.MetricRegistry,
    Effect.sync(() => new Map()),
  ),
)
