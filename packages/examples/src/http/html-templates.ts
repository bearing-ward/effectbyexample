/**
 * @title HTML templates
 * @difficulty intermediate
 * @summary `Template` builds text from a tagged template literal whose holes
 * may be effects or streams. `HttpServerResponse.html` uses the same tag to
 * render a page in a route.
 */

import { Console, Context, Effect, Layer, Option, Stream } from 'effect'
import {
  HttpClient,
  HttpClientResponse,
  HttpRouter,
  HttpServer,
  HttpServerRequest,
  HttpServerResponse,
  Template,
} from 'effect/http'

class Inventory extends Context.Service<
  Inventory,
  { readonly inStock: (sku: string) => Effect.Effect<number> }
>()('app/Inventory') {
  static readonly layer = Layer.succeed(Inventory, {
    inStock: () => Effect.succeed(12),
  })
}

// `Template` does not escape anything. Escape user-controlled text yourself
// before it goes into HTML.
const escapeHtml = (text: string) =>
  text.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;')

export const program = Effect.gen(function* () {
  // A hole can hold a plain value, an `Option` (`None` renders nothing), an
  // array (joined with no separator), or an effect. The result is an effect
  // that needs whatever the holes need, here `Inventory`.
  const sku = 'tea-01'
  const line = Template.make`${sku}: ${Inventory.use((inventory) =>
    inventory.inStock(sku),
  )} in stock${Option.none<string>()}, tags ${['green', '/', 'loose']}`
  yield* Console.log(yield* line)

  // `Template.stream` accepts streams too, and emits each piece as soon as
  // it is available instead of waiting for the whole text.
  const pieces =
    yield* Template.stream`<ul>${Stream.make('<li>Tea</li>', '<li>Mugs</li>')}</ul>`.pipe(
      Stream.runCollect,
    )
  yield* Console.log(pieces)

  // In a route, `HttpServerResponse.html` is the same tag. It sets
  // `content-type: text/html` and runs the effects in the holes on every
  // request. `HttpRouter.use` lets the route layer read `Inventory` once,
  // when the app is built.
  const review = '<script>alert(1)</script> Lovely tea'
  const Page = HttpRouter.use((router) =>
    Effect.gen(function* () {
      const inventory = yield* Inventory
      yield* router.add(
        'GET',
        '/products/tea-01',
        HttpServerResponse.html`<h1>Green tea</h1>
<p>${inventory.inStock(sku)} in stock</p>
<blockquote>${escapeHtml(review)}</blockquote>`,
      )
    }),
  )
  const App = Page.pipe(
    Layer.provide([Inventory.layer, HttpServer.layerServices]),
  )
  const { handler, dispose } = HttpRouter.toWebHandler(App, {
    disableLogger: true,
  })
  const client = HttpClient.make((request) =>
    HttpServerRequest.toWeb(HttpServerRequest.fromClientRequest(request)).pipe(
      Effect.flatMap((web) => Effect.promise(() => handler(web))),
      Effect.map((web) => HttpClientResponse.fromWeb(request, web)),
      Effect.orDie,
    ),
  )

  const response = yield* client.get('http://shop.test/products/tea-01')
  yield* Console.log(response.headers['content-type'])
  yield* Console.log(yield* response.text)
  yield* Effect.promise(dispose)
}).pipe(Effect.provide(Inventory.layer))
