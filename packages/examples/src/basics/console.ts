/**
 * @title Printing with Console
 * @difficulty beginner
 * @summary `Console.log` is `console.log` as an effect. Because the console is
 * a service, you can swap it out: tests capture output, and this site uses
 * that to show you what each example prints.
 */

import { Console, Effect } from 'effect'

// `Console.log` returns an effect. Nothing is printed until it runs, so you
// can store it, repeat it, or pass it around like any other effect.
const greet = Console.log('Welcome back, Ada')

export const program = Effect.gen(function* () {
  yield* greet

  // The usual levels are all there. This page marks anything that is not a
  // plain log with its level.
  yield* Console.info('3 items in your cart')
  yield* Console.warn('the lamp is almost sold out')
  yield* Console.error('coupon SPRING24 has expired')

  // `Console.assert` prints only when the condition is false.
  const stock = 2
  yield* Console.assert(stock > 0, 'this line never prints')
  yield* Console.assert(stock > 5, 'low stock:', stock)

  // Values are formatted the way `console.log` would format them.
  yield* Console.log({ orderId: 'ord-1', items: ['mug', 'lamp'] })

  // The console is a service, so you can provide a different one to part of
  // the program. `Console.consoleWith` hands you the current console; here we
  // wrap it so every log line gets a prefix.
  const audited = Console.consoleWith((current) =>
    Effect.gen(function* () {
      yield* Console.log('order placed')
      yield* Console.log('receipt sent')
    }).pipe(
      Effect.provideService(Console.Console, {
        ...current,
        log: (...args) => current.log('[audit]', ...args),
      }),
    ),
  )
  yield* audited

  // Outside that region the original console is back.
  yield* Console.log('done')
})
