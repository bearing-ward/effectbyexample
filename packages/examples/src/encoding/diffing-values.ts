/**
 * @title Diffing and patching typed values
 * @difficulty advanced
 * @summary A `Differ` describes how to compute the change between two values,
 * combine changes, and apply them. Derive one from any schema to get JSON
 * Patch diffs for your own types, or write one for a domain-specific patch
 * format.
 */

import { Console, Differ, Effect, JsonPatch, Option, Schema } from 'effect'

class Profile extends Schema.Class<Profile>('Profile')({
  name: Schema.String,
  nickname: Schema.Option(Schema.String),
  tags: Schema.Array(Schema.String),
}) {
  get displayName() {
    return Option.getOrElse(this.nickname, () => this.name)
  }
}

// `Schema.toDifferJsonPatch` builds a `Differ` from a schema. It encodes both
// values to JSON, diffs the JSON, and decodes the patched JSON back. That is
// how an `Option` and a class instance can be diffed at all.
const profileDiffer: Differ.Differ<Profile, JsonPatch.JsonPatch> =
  Schema.toDifferJsonPatch(Profile)

// A hand-written `Differ` for stock levels, where the patch is a map of
// quantity changes rather than JSON Patch operations.
type Stock = Readonly<Record<string, number>>
type StockDelta = Readonly<Record<string, number>>

const stockDiffer: Differ.Differ<Stock, StockDelta> = {
  empty: {},
  diff: (oldStock, newStock) => {
    const delta: Record<string, number> = {}
    for (const sku of new Set([
      ...Object.keys(oldStock),
      ...Object.keys(newStock),
    ])) {
      const change = (newStock[sku] ?? 0) - (oldStock[sku] ?? 0)
      if (change !== 0) delta[sku] = change
    }
    return delta
  },
  combine: (first, second) => {
    const delta: Record<string, number> = { ...first }
    for (const [sku, change] of Object.entries(second)) {
      delta[sku] = (delta[sku] ?? 0) + change
    }
    return delta
  },
  patch: (stock, delta) => {
    const next: Record<string, number> = { ...stock }
    for (const [sku, change] of Object.entries(delta)) {
      next[sku] = (next[sku] ?? 0) + change
    }
    return next
  },
}

export const program = Effect.gen(function* () {
  const v1 = new Profile({
    name: 'Ada',
    nickname: Option.none(),
    tags: ['admin'],
  })
  const v2 = new Profile({
    name: 'Ada',
    nickname: Option.some('Countess'),
    tags: ['admin', 'beta'],
  })

  // The patch is ordinary JSON Patch, ready to store or send.
  const patch = profileDiffer.diff(v1, v2)
  yield* Console.log(patch)

  // Applying it gives back a real `Profile`, methods included.
  const patched = profileDiffer.patch(v1, patch)
  yield* Console.log(patched instanceof Profile, patched.displayName)

  // An empty patch leaves the value as it was.
  yield* Console.log(profileDiffer.patch(v1, profileDiffer.empty) === v1)

  // `combine` merges two changes into one. Here two days of stock movements
  // become a single delta that takes Monday's stock straight to Wednesday's.
  const monday = { 'SKU-1': 10, 'SKU-2': 4 }
  const tuesday = { 'SKU-1': 7, 'SKU-2': 4, 'SKU-3': 5 }
  const wednesday = { 'SKU-1': 12, 'SKU-2': 0, 'SKU-3': 5 }
  const twoDays = stockDiffer.combine(
    stockDiffer.diff(monday, tuesday),
    stockDiffer.diff(tuesday, wednesday),
  )
  yield* Console.log(twoDays)
  yield* Console.log(stockDiffer.patch(monday, twoDays))
})
