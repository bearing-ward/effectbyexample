/**
 * @title Effects are values
 * @difficulty beginner
 * @summary An `Effect` is a description of work, not the work itself.
 * Creating one does nothing. It runs only when something runs it, and it runs
 * again every time it is run.
 */

import { Console, Effect } from 'effect'

export const program = Effect.gen(function* () {
  // A plain counter so we can see when the work really happens.
  let charges = 0

  // `Effect.sync` wraps a side effect in a description. Building `chargeCard`
  // does not touch `charges`. Compare this with a `Promise`, which starts
  // running the moment you create it.
  const chargeCard = Effect.sync(() => {
    charges += 1
    return `charge #${charges}`
  })

  // The type says what running it would produce: `Effect<string, never,
  // never>` succeeds with a string, cannot fail, and needs no services.
  const described: Effect.Effect<string> = chargeCard

  // Nothing has run yet, even though `chargeCard` exists.
  yield* Console.log(`charges before running: ${charges}`)

  // `yield*` runs the effect and hands back its result.
  const first = yield* described
  yield* Console.log(first)

  // Because an effect is a recipe, running it again repeats the work. A
  // resolved promise would hand back the same cached value instead.
  const second = yield* chargeCard
  yield* Console.log(second)

  // Combinators also build new descriptions without running anything.
  // `Effect.repeat` describes "run this, then two more times".
  const threeMore = chargeCard.pipe(Effect.repeat({ times: 2 }))
  yield* Console.log(`charges after building threeMore: ${charges}`)

  yield* threeMore
  yield* Console.log(`charges after running threeMore: ${charges}`)
})
