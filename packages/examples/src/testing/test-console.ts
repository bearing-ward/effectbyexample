/**
 * @title Capturing output with TestConsole
 * @difficulty beginner
 * @summary When the behavior you care about is what a program prints,
 * `TestConsole` records every `Console` call so you can inspect the lines
 * instead of reading a terminal.
 */

import { Console, Effect } from 'effect'
import { TestConsole } from 'effect/testing'

interface LineItem {
  readonly name: string
  readonly cents: number
}

// The code under test prints a receipt and warns on stderr when the cart is
// empty. It uses `Console`, a service, rather than the global `console`.
const printReceipt = (items: ReadonlyArray<LineItem>) =>
  Effect.gen(function* () {
    if (items.length === 0) {
      yield* Console.error('cannot print a receipt for an empty cart')
      return
    }
    for (const item of items) {
      yield* Console.log(`${item.name}: $${(item.cents / 100).toFixed(2)}`)
    }
    const total = items.reduce((sum, item) => sum + item.cents, 0)
    yield* Console.log(`Total: $${(total / 100).toFixed(2)}`)
  })

// Run the code with `TestConsole.layer` provided, then read back what it
// printed. `logLines` holds the arguments of `Console.log` calls and
// `errorLines` the arguments of `Console.error` calls.
const capture = <A, E>(effect: Effect.Effect<A, E>) =>
  Effect.gen(function* () {
    yield* effect
    return {
      log: yield* TestConsole.logLines,
      error: yield* TestConsole.errorLines,
    }
  }).pipe(Effect.provide(TestConsole.layer))

export const program = Effect.gen(function* () {
  const receipt = yield* capture(
    printReceipt([
      { name: 'Coffee beans', cents: 1450 },
      { name: 'Filter papers', cents: 399 },
    ]),
  )
  // Nothing reached the real console. The lines are plain data now, ready
  // for assertions.
  yield* Console.log(receipt)
  yield* Console.log(receipt.log.at(-1) === 'Total: $18.49')

  // Each capture gets a fresh `TestConsole`, so runs do not leak into each
  // other.
  const empty = yield* capture(printReceipt([]))
  yield* Console.log(empty)
})
