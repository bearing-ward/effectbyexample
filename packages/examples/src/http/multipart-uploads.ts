/**
 * @title Multipart uploads
 * @difficulty advanced
 * @summary HTML forms with file inputs send `multipart/form-data`. The server
 * reads such a body as a stream of parts with `Multipart`, so it can stream a
 * large file instead of holding it in memory, and limits reject oversized
 * uploads.
 */

import { Console, Effect, Layer, Stream } from 'effect'
import {
  HttpBody,
  HttpClient,
  HttpClientRequest,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  Multipart,
  MultipartParser,
} from 'effect/http'

// This is what a browser sends for a form with a `title` field and a
// `receipt` file. Each part sits between boundary lines and has its own
// headers.
const boundary = 'expense-form'
const body = [
  `--${boundary}`,
  'Content-Disposition: form-data; name="title"',
  '',
  'Taxi to the airport',
  `--${boundary}`,
  'Content-Disposition: form-data; name="receipt"; filename="receipt.txt"',
  'Content-Type: text/plain',
  '',
  'Total: 42.00 EUR',
  `--${boundary}--`,
  '',
].join('\r\n')
const contentType = `multipart/form-data; boundary=${boundary}`

// The handler reads `multipartStream`: fields arrive with their value, files
// with a stream of their bytes. `contentEffect` collects one file's bytes.
const describeParts = Effect.gen(function* () {
  const request = yield* HttpServerRequest.HttpServerRequest
  const lines = yield* request.multipartStream.pipe(
    Stream.mapEffect((part) =>
      Multipart.isFile(part)
        ? Effect.map(
            part.contentEffect,
            (bytes) => `file ${part.key}: ${part.name}, ${bytes.length} bytes`,
          )
        : Effect.succeed(`field ${part.key}: ${part.value}`),
    ),
    Stream.runCollect,
  )
  return HttpServerResponse.jsonUnsafe(lines)
})

// Limits are context references, so one route can be stricter than
// another. On `/avatars` a file may be at most 10 bytes. A bigger one fails
// with a `MultipartError`, which answers 413 Payload Too Large.
const Routes = Layer.mergeAll(
  HttpRouter.add('POST', '/expenses', describeParts),
  HttpRouter.add(
    'POST',
    '/avatars',
    describeParts.pipe(
      Effect.provide(Multipart.limitsServices({ maxFileSize: 10 })),
    ),
  ),
).pipe(Layer.provide(HttpServer.layerServices))

const InMemoryClient = Layer.effect(
  HttpClient.HttpClient,
  Effect.gen(function* () {
    const { handler } = yield* Effect.acquireRelease(
      Effect.sync(() =>
        HttpRouter.toWebHandler(Routes, { disableLogger: true }),
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
  const upload = (path: string) =>
    client.execute(
      HttpClientRequest.post(`http://expenses.test${path}`).pipe(
        HttpClientRequest.bodyText(body, contentType),
      ),
    )

  const accepted = yield* upload('/expenses')
  yield* Console.log(accepted.status, yield* accepted.json)

  const rejected = yield* upload('/avatars')
  yield* Console.log(rejected.status)

  // Underneath sits `MultipartParser`, a callback-based push parser with no
  // Effect in it. You rarely need it unless you are writing a platform
  // integration, but it shows what the parts look like. `HttpBody.text`
  // gives us the body as bytes to feed it.
  const events: Array<string> = []
  const parser = MultipartParser.make({
    headers: { 'content-type': contentType },
    onField: (info, value) =>
      events.push(
        `field ${info.name}=${MultipartParser.decodeField(info, value)}`,
      ),
    onFile: (info) => (chunk) =>
      events.push(
        chunk === null
          ? `end of ${info.filename}`
          : `chunk of ${info.filename}`,
      ),
    onError: (error) => events.push(`error ${error._tag}`),
    onDone: () => events.push('done'),
  })
  parser.write(HttpBody.text(body).body)
  parser.end()
  yield* Console.log(events)
}).pipe(Effect.provide(InMemoryClient))
