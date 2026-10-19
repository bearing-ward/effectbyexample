/**
 * @title Pattern matching with Match
 * @difficulty intermediate
 * @summary `Match` replaces long `if`/`switch` chains with a list of cases.
 * It narrows types inside each case and, with `exhaustive`, makes the
 * compiler tell you when a new case is not handled.
 */

import { Console, Effect, Match } from 'effect'

type PaymentEvent =
  | { readonly _tag: 'Authorized'; readonly cents: number }
  | { readonly _tag: 'Captured'; readonly cents: number }
  | {
      readonly _tag: 'Refunded'
      readonly cents: number
      readonly reason: string
    }
  | { readonly _tag: 'Failed'; readonly code: string }

// `Match.type<T>()` starts a matcher for values of type `T`. Each
// `Match.tag` case handles one `_tag`, and the handler sees only that member
// of the union. `exhaustive` finishes the matcher and returns a function. If
// someone adds a fifth event type, this stops compiling until it is handled.
const describe = Match.type<PaymentEvent>().pipe(
  Match.tag('Authorized', (event) => `hold ${event.cents} cents`),
  Match.tag('Captured', (event) => `took ${event.cents} cents`),
  Match.tag(
    'Refunded',
    (event) => `returned ${event.cents} cents (${event.reason})`,
  ),
  Match.tag('Failed', (event) => `failed with ${event.code}`),
  Match.exhaustive,
)

// `Match.when` matches on the shape of a value. A pattern can hold literal
// values or predicates. Cases are tried in order, so put specific ones first.
// `orElse` handles everything that is left.
const shippingRate = Match.type<{
  readonly country: string
  readonly kg: number
}>().pipe(
  Match.when({ country: 'NL', kg: (kg) => kg < 2 }, () => 'free'),
  Match.when({ country: 'NL' }, () => '4.95'),
  Match.when({ kg: (kg) => kg >= 20 }, () => 'freight quote needed'),
  Match.orElse(({ country }) => `international rate for ${country}`),
)

// `Match.value` matches one value right away instead of building a function.
// Built-in predicates like `Match.number` and `Match.string` match by type.
const label = (input: string | number | boolean) =>
  Match.value(input).pipe(
    Match.when(Match.number, (n) => `number ${n.toFixed(2)}`),
    Match.when(Match.string, (s) => `text "${s}"`),
    Match.orElse((b) => `flag ${b}`),
  )

export const program = Effect.gen(function* () {
  const events: ReadonlyArray<PaymentEvent> = [
    { _tag: 'Authorized', cents: 2500 },
    { _tag: 'Captured', cents: 2500 },
    { _tag: 'Refunded', cents: 500, reason: 'damaged' },
    { _tag: 'Failed', code: 'card_expired' },
  ]
  for (const event of events) {
    yield* Console.log(describe(event))
  }

  yield* Console.log(shippingRate({ country: 'NL', kg: 1 }))
  yield* Console.log(shippingRate({ country: 'NL', kg: 5 }))
  yield* Console.log(shippingRate({ country: 'DE', kg: 25 }))
  yield* Console.log(shippingRate({ country: 'DE', kg: 3 }))

  yield* Console.log(label(4.5), '|', label('mug'), '|', label(true))
})
