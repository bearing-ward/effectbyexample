/**
 * @title Strings and regular expressions
 * @difficulty beginner
 * @summary The `String` module puts the usual string methods in a form that
 * fits `pipe`, adds case conversions you would otherwise copy from a blog
 * post, and returns `Option` where a lookup can miss. `RegExp.escape` makes
 * user input safe to put inside a pattern.
 */

import { Console, Effect, pipe, RegExp, String } from 'effect'

export const program = Effect.gen(function* () {
  // Every string method is a function that takes the string last, so a
  // cleanup reads as a list of steps.
  const slug = pipe(
    '  Blue Ceramic Mug  ',
    String.trim,
    String.toLowerCase,
    String.replaceAll(' ', '-'),
  )
  yield* Console.log(slug)

  // Case conversions turn identifiers between the styles that APIs, CSS,
  // environment variables, and TypeScript each prefer.
  yield* Console.log(String.camelCase('shipping_address'))
  yield* Console.log(String.snakeCase('customerId'))
  yield* Console.log(String.kebabCase('Blue Ceramic Mug'))
  yield* Console.log(String.constantCase('maxRetries'))

  // Lookups that can miss return an `Option` instead of `undefined` or
  // `null`.
  yield* Console.log(String.at('mug', -1))
  yield* Console.log(String.match(/\d+/)('order 42 shipped'))
  yield* Console.log(String.match(/\d+/)('no order here'))

  // `takeLeft` keeps at most that many characters, and `isNonEmpty` is a
  // ready-made check for empty input.
  yield* Console.log(String.takeLeft('A very long product title', 12))
  yield* Console.log('has a note:', String.isNonEmpty(''))

  // A search box that builds a regular expression from what the user typed
  // breaks on characters like `+` or `(`: `C++` is not even a valid pattern.
  // `RegExp.escape` makes the input match literally. The `RegExp` import shadows the global constructor, so
  // we reach it through `globalThis`.
  const titles = ['C++ in Practice', 'CPP for Beginners', 'C (2nd edition)']
  for (const query of ['C++', 'C (']) {
    const pattern = new globalThis.RegExp(RegExp.escape(query), 'i')
    yield* Console.log(
      query,
      '->',
      titles.filter((title) => pattern.test(title)),
    )
  }

  // `RegExp.isRegExp` is the guard for checking an unknown value.
  yield* Console.log(RegExp.isRegExp(/mug/), RegExp.isRegExp('mug'))
})
