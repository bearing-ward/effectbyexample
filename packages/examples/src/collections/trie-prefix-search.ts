/**
 * @title Prefix search with Trie
 * @difficulty intermediate
 * @summary A `Trie` stores string keys by their characters, so keys that
 * share a beginning share storage. That makes two questions cheap: "which
 * keys start with this?" for autocomplete, and "which key is the longest
 * prefix of this?" for routing by prefix.
 */

import { Console, Effect, Option, pipe, Trie } from 'effect'

export const program = Effect.gen(function* () {
  // Product names mapped to their stock-keeping unit. A trie is an
  // immutable map from strings to values, like a `HashMap` with string
  // keys.
  const products = Trie.make(
    ['tea', 'sku-101'],
    ['teapot', 'sku-102'],
    ['teacup', 'sku-103'],
    ['tent', 'sku-201'],
    ['torch', 'sku-301'],
  )

  // Autocomplete: as the customer types, ask for every key that starts
  // with what they typed so far. The trie walks to the prefix and only
  // visits keys below it.
  for (const typed of ['t', 'te', 'tea', 'teap']) {
    yield* Console.log(typed, Array.from(Trie.keysWithPrefix(products, typed)))
  }

  // `toEntriesWithPrefix` returns keys with their values.
  yield* Console.log(Trie.toEntriesWithPrefix(products, 'teac'))

  // `insert` returns a new trie. The original keeps its five products.
  const more = Trie.insert(products, 'teabag', 'sku-104')
  yield* Console.log(Trie.size(products), Trie.size(more))

  // The other direction: given a full string, find the longest stored key
  // that is a prefix of it. Here the trie holds phone number prefixes, and
  // each call is routed to the most specific carrier that matches.
  const carriers = Trie.make(
    ['+1', 'North America'],
    ['+44', 'United Kingdom'],
    ['+4420', 'London'],
  )

  const route = (phone: string) =>
    pipe(
      Trie.longestPrefixOf(carriers, phone),
      Option.match({
        onNone: () => `${phone}: no route`,
        onSome: ([prefix, carrier]) => `${phone}: ${carrier} (${prefix})`,
      }),
    )

  yield* Console.log(route('+442079460000'))
  yield* Console.log(route('+441614960000'))
  yield* Console.log(route('+15550100'))
  yield* Console.log(route('+33140000000'))
})
