/**
 * @title JSON Patch and JSON Pointer
 * @difficulty intermediate
 * @summary Send what changed instead of the whole document. `JsonPatch`
 * computes a list of `add`, `remove`, and `replace` operations between two
 * JSON values and applies them later. Each operation names its target with a
 * JSON Pointer path, which `JsonPointer` helps you build safely.
 */

import { Console, Effect, JsonPatch, JsonPointer } from 'effect'

const before = {
  status: 'draft',
  items: [{ sku: 'SKU-1', qty: 1 }],
  shipping: { 'express/overnight': false },
  coupon: 'WELCOME10',
}

const after = {
  status: 'placed',
  items: [
    { sku: 'SKU-1', qty: 2 },
    { sku: 'SKU-9', qty: 1 },
  ],
  shipping: { 'express/overnight': true },
}

export const program = Effect.gen(function* () {
  // `get` diffs two JSON values. Keys are visited in sorted order and arrays
  // by index, so the same inputs always give the same patch.
  const patch = JsonPatch.get(before, after)
  yield* Console.log(patch)

  // A `/` inside a key would be read as a path separator, so pointers escape
  // it as `~1` (and `~` as `~0`). That is the `express~1overnight` above.
  yield* Console.log(JsonPointer.escapeToken('express/overnight'))
  yield* Console.log(JsonPointer.unescapeToken('express~1overnight'))

  // `apply` replays the operations in order. It returns a new document and
  // leaves the input untouched.
  const patched = JsonPatch.apply(patch, before)
  yield* Console.log(JSON.stringify(patched) === JSON.stringify(after))
  yield* Console.log(before.status)

  // Patches are plain data, so you can also write them by hand. A path
  // ending in `-` appends to an array.
  const addGift = JsonPatch.apply(
    [{ op: 'add', path: '/items/-', value: { sku: 'GIFT', qty: 1 } }],
    patched,
  )
  yield* Console.log(addGift)

  // `apply` throws when a path does not exist, so wrap patches from
  // untrusted sources with `Effect.try`.
  const rejected = yield* Effect.try(() =>
    JsonPatch.apply([{ op: 'remove', path: '/payment/card' }], before),
  ).pipe(Effect.catch((error) => Effect.succeed(String(error.cause))))
  yield* Console.log(rejected)

  // In a URI fragment, such as a `$ref` in JSON Schema, the pointer is also
  // percent-encoded. These two functions convert between the fragment and
  // the list of keys.
  const fragment = JsonPointer.formatUriFragment(['$defs', 'Order Line'])
  yield* Console.log(fragment)
  yield* Console.log(JsonPointer.parseUriFragment(fragment))
})
