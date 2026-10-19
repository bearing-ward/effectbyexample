/**
 * @title Path patterns
 * @difficulty intermediate
 * @summary `HttpRouter` matches paths with `FindMyWay`, a port of the
 * find-my-way router. Using it directly shows the pattern syntax: named
 * parameters, optional ones, regular expressions, and wildcards.
 */

import { Console, Effect } from 'effect'
import { FindMyWay } from 'effect/http'

// The router maps a method and a path pattern to any value. `HttpRouter`
// stores handlers here; we store labels.
const router = FindMyWay.make<string>()
router.on('GET', '/products/:id', 'one product')
// A static segment beats a parameter, whatever the order you register them.
router.on('GET', '/products/featured', 'featured products')
// A regular expression in parentheses restricts what a parameter accepts.
router.on('GET', '/orders/:id(^\\d+$)', 'one order')
// A trailing `?` makes the last parameter optional.
router.on('GET', '/archive/:year/:month?', 'archive')
// `*` matches the rest of the path, slashes included.
router.on('GET', '/files/*', 'a file')
// One pattern can serve several methods.
router.on(['GET', 'POST'], '/cart', 'the cart')

const lookup = (method: string, url: string) => {
  const found = router.find(method, url)
  return found === undefined
    ? `${method} ${url} -> no match`
    : `${method} ${url} -> ${found.handler} ${JSON.stringify(found.params)}`
}

export const program = Effect.gen(function* () {
  yield* Console.log(lookup('GET', '/products/42'))
  yield* Console.log(lookup('GET', '/products/featured'))
  yield* Console.log(lookup('GET', '/orders/1001'))
  yield* Console.log(lookup('GET', '/orders/latest'))
  yield* Console.log(lookup('GET', '/archive/2024'))
  yield* Console.log(lookup('GET', '/archive/2024/05'))
  yield* Console.log(lookup('GET', '/files/invoices/2024/may.pdf'))
  yield* Console.log(lookup('DELETE', '/cart'))

  // The query string is not part of the match. It is parsed separately,
  // and repeated keys become arrays.
  const withQuery = router.find('GET', '/products/42?color=red&color=blue')
  yield* Console.log(
    JSON.stringify(withQuery?.params),
    JSON.stringify(withQuery?.searchParams),
  )

  // By default a trailing slash and letter case are ignored. `HttpRouter`
  // takes the same settings through its `routerConfig` option.
  const strict = FindMyWay.make<string>({
    caseSensitive: true,
    ignoreTrailingSlash: false,
  })
  strict.on('GET', '/products/:id', 'one product')
  for (const url of ['/PRODUCTS/42', '/products/42/']) {
    const lenient = router.find('GET', url) !== undefined
    const exact = strict.find('GET', url) !== undefined
    yield* Console.log(`${url}: default ${lenient}, strict ${exact}`)
  }
})
