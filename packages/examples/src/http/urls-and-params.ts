/**
 * @title URLs and query parameters
 * @difficulty beginner
 * @summary `Url` parses and edits URLs without throwing or mutating, and
 * `UrlParams` is an ordered list of query parameters that keeps repeated
 * keys. `Mime` maps file names to content types.
 */

import { Console, Effect, Option, pipe, Result } from 'effect'
import { Mime, Url, UrlParams } from 'effect/http'

export const program = Effect.gen(function* () {
  // `new URL` throws on bad input. `Url.fromString` returns a `Result`
  // instead, so a bad link is a value you can handle.
  const parsed = Url.fromString('https://shop.test/search?q=tea')
  const broken = Url.fromString('not a url')
  yield* Console.log(Result.isSuccess(parsed), Result.isSuccess(broken))

  // A relative path resolves against a base.
  const relative = Url.fromString('/cart', 'https://shop.test')
  yield* Console.log(Result.map(relative, (url) => url.href))

  // The setters return a new `URL` and leave the original alone, unlike
  // assigning to `url.pathname`.
  const base = Result.getOrThrow(parsed)
  const page2 = pipe(
    base,
    Url.setPathname('/products'),
    Url.modifyUrlParams(UrlParams.set('page', '2')),
  )
  yield* Console.log(base.href)
  yield* Console.log(page2.href)

  // `UrlParams` keeps every value of a repeated key, in order.
  const filters = UrlParams.fromInput({
    tag: ['green', 'loose-leaf'],
    q: 'tea',
  })
  const more = UrlParams.append(filters, 'tag', 'organic')
  yield* Console.log(UrlParams.toString(more))
  yield* Console.log(UrlParams.getAll(more, 'tag'))

  // Reading a single value gives an `Option`, because the key may be absent.
  yield* Console.log(
    UrlParams.getFirst(more, 'q'),
    UrlParams.getFirst(more, 'page'),
  )

  // `toRecord` turns repeated keys into arrays.
  yield* Console.log(UrlParams.toRecord(more))

  // Signed URLs carry secrets in the query string. `redactUrl` hides the
  // values of well-known signature parameters before you log the URL.
  yield* Console.log(
    UrlParams.redactUrl(
      'https://files.test/invoice.pdf?Signature=abc123&expires=600',
    ),
  )

  // `Mime` looks up content types by file name, and extensions by type.
  // Both return an `Option`, since the lookup can miss.
  yield* Console.log(
    ['invoice.pdf', 'photo.webp', 'notes.unknown'].map((file) =>
      Option.getOrElse(Mime.getType(file), () => 'no match'),
    ),
  )
  yield* Console.log(Mime.getExtension('text/csv'))
})
