/**
 * @title Serving API docs
 * @difficulty intermediate
 * @summary Three layers turn an API definition into documentation routes: the
 * raw OpenAPI JSON, a Scalar reference page, and a Swagger UI page. Merge them
 * with your API routes and they are served by the same router.
 */

import { Console, Effect, Layer, Schema } from 'effect'
import {
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
} from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiScalar,
  HttpApiSwagger,
  OpenApi,
} from 'effect/http-api'

const Api = HttpApi.make('weather')
  .add(
    HttpApiGroup.make('forecast').add(
      HttpApiEndpoint.get('today', '/forecast/:city', {
        params: { city: Schema.String },
        success: Schema.Struct({ city: Schema.String, celsius: Schema.Number }),
      }),
    ),
  )
  .annotateMerge(OpenApi.annotations({ title: 'Weather API' }))

const ForecastLive = HttpApiBuilder.group(Api, 'forecast', (handlers) =>
  handlers.handle('today', ({ params }) =>
    Effect.succeed({ city: params.city, celsius: 18 }),
  ),
)

// `openapiPath` adds a route that serves `OpenApi.fromApi(Api)` as JSON.
// The Scalar and Swagger layers each add an HTML page that renders the same
// document. `HttpApiSwagger.layer` and `HttpApiScalar.layer` ship their
// JavaScript inside your app, megabytes of it. `HttpApiScalar.layerCdn`
// keeps your bundle small: its page loads Scalar from jsDelivr instead.
const AppLive = Layer.mergeAll(
  HttpApiBuilder.layer(Api, { openapiPath: '/openapi.json' }).pipe(
    Layer.provide(ForecastLive),
  ),
  HttpApiScalar.layerCdn(Api, { path: '/docs' }),
  HttpApiSwagger.layer(Api, { path: '/swagger' }),
).pipe(Layer.provide(HttpServer.layerServices))

export const program = Effect.gen(function* () {
  // Serve the routes in memory and point a plain `HttpClient` at them.
  const { handler } = yield* Effect.acquireRelease(
    Effect.sync(() =>
      HttpRouter.toWebHandler(AppLive, { disableLogger: true }),
    ),
    ({ dispose }) => Effect.promise(dispose),
  )
  const client = HttpClient.make((request) =>
    HttpServerRequest.toWeb(HttpServerRequest.fromClientRequest(request)).pipe(
      Effect.flatMap((web) => Effect.promise(() => handler(web))),
      Effect.map((response) => HttpClientResponse.fromWeb(request, response)),
      Effect.orDie,
    ),
  )

  const spec = yield* client.get('http://weather.test/openapi.json').pipe(
    Effect.flatMap(
      HttpClientResponse.schemaBodyJson(
        Schema.Struct({
          info: Schema.Struct({ title: Schema.String }),
          paths: Schema.Record(Schema.String, Schema.Unknown),
        }),
      ),
    ),
  )
  yield* Console.log(spec.info.title, Object.keys(spec.paths))

  // The doc pages are HTML with the OpenAPI document embedded, so the API
  // title appears in each. Point a browser at `/docs` or `/swagger` to read
  // the reference and try the endpoints by hand.
  for (const path of ['/docs', '/swagger']) {
    const page = yield* client.get(`http://weather.test${path}`)
    const html = yield* page.text
    yield* Console.log(
      path,
      page.status,
      page.headers['content-type'],
      html.match(/<title>(.*?)<\/title>/)?.[1],
      html.includes('Weather API'),
      html.includes('cdn.jsdelivr.net'),
    )
  }

  // The API itself is served by the same router, next to its docs.
  const forecast = yield* client
    .get('http://weather.test/forecast/Oslo')
    .pipe(Effect.flatMap((response) => response.json))
  yield* Console.log(forecast)
}).pipe(Effect.scoped)
