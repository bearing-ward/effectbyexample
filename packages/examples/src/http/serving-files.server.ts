/**
 * @title Serving files with a real server
 * @difficulty advanced
 * @summary On Node, `NodeHttpServer` runs your routes on a real socket.
 * `HttpStaticServer` serves a directory with content types, ETags, and
 * `304 Not Modified`, and `HttpServerResponse.file` streams a single file.
 * A `FetchHttpClient` calls the server over localhost.
 */

// `NodeHttpServer.layer` provides the `HttpServer` plus the Node versions of
// `HttpPlatform` (how files become responses), `Etag.Generator`, and the
// file system.
import { NodeHttpServer, NodeServices } from '@effect/platform-node'
import { Console, Effect, FileSystem, Layer, Path, Schema } from 'effect'
import {
  Etag,
  FetchHttpClient,
  HttpClient,
  HttpIncomingMessage,
  HttpPlatform,
  HttpRouter,
  HttpServer,
  HttpServerResponse,
  HttpStaticServer,
  HttpStatus,
} from 'effect/http'
import { createServer } from 'node:http'

const makeApp = (root: string) =>
  Layer.mergeAll(
    // Everything under `root` is served at `/static`. The content type comes
    // from the file extension, and the ETag from the file's size and
    // modification time.
    HttpStaticServer.layer({
      root,
      prefix: '/static',
      cacheControl: 'max-age=60',
    }),
    // One file as a download. `HttpServerResponse.file` asks the
    // `HttpPlatform` service to stream it from disk.
    HttpRouter.add(
      'GET',
      '/report',
      HttpServerResponse.file(`${root}/report.csv`, {
        headers: { 'content-disposition': 'attachment; filename="report.csv"' },
      }),
    ),
    // Data that is not a file can have an ETag too. `Etag.toString` formats
    // one, and the handler answers 304 when the client already has it.
    HttpRouter.add('GET', '/menu', (request) => {
      const etag = Etag.toString({ _tag: 'Weak', value: 'menu-v3' })
      return request.headers['if-none-match'] === etag
        ? Effect.succeed(
            HttpServerResponse.empty({
              status: HttpStatus.fromLiteral('NotModified'),
              headers: { etag },
            }),
          )
        : HttpServerResponse.json(['Tea', 'Scones'], { headers: { etag } })
    }),
  )

// The headers we care about, decoded with a schema like any other input.
const CacheHeaders = Schema.Struct({
  'content-type': Schema.String,
  'cache-control': Schema.optional(Schema.String),
  etag: Schema.optional(Schema.String),
})

export const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const root = yield* fs.makeTempDirectoryScoped({ prefix: 'site-' })
  yield* fs.writeFileString(path.join(root, 'index.html'), '<h1>Tea shop</h1>')
  yield* fs.writeFileString(
    path.join(root, 'report.csv'),
    'item,sold\ntea,12\n',
  )

  // Port 0 asks the OS for any free port. `HttpRouter.serve` turns the
  // routes into a running server, and `layerTestClient` gives an
  // `HttpClient` that sends relative URLs to wherever it listens.
  const ServerLive = HttpRouter.serve(makeApp(root), {
    disableLogger: true,
    disableListenLog: true,
  }).pipe(Layer.provideMerge(NodeHttpServer.layer(createServer, { port: 0 })))
  const ClientLive = HttpServer.layerTestClient.pipe(
    Layer.provide(FetchHttpClient.layer),
    Layer.provideMerge(ServerLive),
  )

  yield* Effect.gen(function* () {
    const client = yield* HttpClient.HttpClient

    // The ETag changes whenever the file does, so we print only that one
    // came back.
    const page = yield* client.get('/static/index.html')
    const headers = yield* HttpIncomingMessage.schemaHeaders(CacheHeaders)(page)
    yield* Console.log(
      page.status,
      headers['content-type'],
      headers['cache-control'],
      headers.etag !== undefined,
    )

    // Sending the ETag back asks "has it changed?". It has not, so the
    // server answers 304 with no body and the browser keeps its copy.
    const again = yield* client.get('/static/index.html', {
      headers: { 'if-none-match': headers.etag ?? '' },
    })
    yield* Console.log(again.status, JSON.stringify(yield* again.text))

    const report = yield* client.get('/report')
    yield* Console.log(
      report.status,
      report.headers['content-type'],
      report.headers['content-disposition'],
    )
    yield* Console.log(yield* report.text)

    const menu = yield* client.get('/menu')
    const etag = menu.headers['etag'] ?? ''
    const cached = yield* client.get('/menu', {
      headers: { 'if-none-match': etag },
    })
    yield* Console.log(etag, menu.status, cached.status)

    // `HttpPlatform` reports which runtime it serves for.
    yield* Console.log((yield* HttpPlatform.HttpPlatform).platform)
  }).pipe(Effect.provide(ClientLive))
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
