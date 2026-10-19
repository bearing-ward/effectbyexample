/**
 * @title Generating OpenAPI
 * @difficulty intermediate
 * @summary The API definition already knows every path, schema, status code,
 * and security scheme, so `OpenApi.fromApi` can write the OpenAPI 3.1
 * document for you. Annotations add the human parts: titles, summaries, and
 * descriptions.
 */

import { Console, Effect, Schema } from 'effect'
import {
  HttpApi,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiMiddleware,
  HttpApiSecurity,
  OpenApi,
} from 'effect/http-api'

// A schema with an `identifier` is written once under
// `components.schemas` and referenced from every place that uses it.
const Book = Schema.Struct({
  isbn: Schema.String,
  title: Schema.String,
}).annotate({ identifier: 'Book' })

class BookNotFound extends Schema.TaggedError<BookNotFound>()(
  'BookNotFound',
  { isbn: Schema.String },
  { httpApiStatus: 404 },
) {}

// Security middleware contributes its schemes to the document.
class Auth extends HttpApiMiddleware.Service<Auth>()('app/Auth', {
  security: { bearer: HttpApiSecurity.bearer },
}) {}

// `OpenApi.annotations` works on the API, groups, and endpoints. A group
// becomes a tag, and an endpoint becomes an operation.
const Api = HttpApi.make('library')
  .add(
    HttpApiGroup.make('books')
      .add(
        HttpApiEndpoint.get('getBook', '/books/:isbn', {
          params: { isbn: Schema.String },
          success: Book,
          error: BookNotFound,
        }).annotateMerge(OpenApi.annotations({ summary: 'Find a book' })),
      )
      .middleware(Auth)
      .annotateMerge(OpenApi.annotations({ description: 'The catalogue' })),
  )
  .annotateMerge(
    OpenApi.annotations({ title: 'Library API', version: '1.2.0' }),
  )

export const program = Effect.gen(function* () {
  // `fromApi` is a plain function: no server, no handlers needed.
  const spec = OpenApi.fromApi(Api)

  yield* Console.log(spec.openapi, spec.info)
  yield* Console.log(spec.tags)

  // Path parameters are rewritten from `:isbn` to OpenAPI's `{isbn}`. The
  // operation id is the group and endpoint names joined by a dot.
  const operation = spec.paths['/books/{isbn}']?.get
  yield* Console.log(operation?.operationId, operation?.summary)
  yield* Console.log(operation?.security)

  // Each declared status gets a response: 200 for the book and 404 for the
  // error.
  yield* Console.log(Object.keys(operation?.responses ?? {}))

  // `Book` is in the components because of its identifier. The tagged error
  // is extracted as well, under the name `BookNotFoundEncoded`.
  yield* Console.log(Object.keys(spec.components.schemas))
  yield* Console.log(spec.components.securitySchemes)
})
