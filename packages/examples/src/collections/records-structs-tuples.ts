/**
 * @title Records, structs, and tuples
 * @difficulty beginner
 * @summary Plain objects play two roles: a dictionary of same-typed values
 * keyed by strings, or a fixed shape with known fields. `Record` helps with
 * the first, `Struct` with the second, and `Tuple` with fixed-position
 * arrays. All of them return new values and keep precise types.
 */

import { Console, Effect, Option, pipe, Record, Struct, Tuple } from 'effect'

export const program = Effect.gen(function* () {
  // A record is a dictionary: any number of keys, all values the same type.
  // Here, stock levels by product code.
  const stock: Record<string, number> = { apple: 12, pear: 0, plum: 7 }

  // `Record.filter` and `Record.map` work on the values and keep the keys.
  const inStock = pipe(
    stock,
    Record.filter((count) => count > 0),
    Record.map((count) => `${count} left`),
  )
  yield* Console.log(inStock)

  // Looking up a key that may be missing returns an `Option`, not
  // `undefined`.
  yield* Console.log(Option.getOrElse(Record.get(stock, 'kiwi'), () => 0))

  // `union` merges two records and decides what to do on a clash.
  const delivery = { pear: 20, kiwi: 5 }
  yield* Console.log(Record.union(stock, delivery, (a, b) => a + b))

  // A struct is a fixed shape. The `Struct` helpers know each field's name
  // and type, so the result types stay exact.
  const user = {
    id: 'u-1',
    name: 'ada lovelace',
    email: 'ADA@EXAMPLE.COM',
    passwordHash: 'x9f3',
  }

  // `omit` drops fields, which is handy before sending data to a client.
  // `evolve` transforms selected fields and leaves the rest alone.
  const publicUser = pipe(
    user,
    Struct.omit(['passwordHash']),
    Struct.evolve({
      name: (name) => name.toUpperCase(),
      email: (email) => email.toLowerCase(),
    }),
  )
  yield* Console.log(publicUser)

  // `pick` keeps only the named fields, and `renameKeys` renames them.
  yield* Console.log(
    pipe(
      user,
      Struct.pick(['id', 'name']),
      Struct.renameKeys({ id: 'userId' }),
    ),
  )

  // A tuple is a fixed-length array where each position has its own type.
  // `Tuple.make` infers the type `["apple", 3]`, where an array literal
  // would give `(string | number)[]`.
  const line = Tuple.make('apple', 3)

  // `Tuple.evolve` transforms by position, and `appendElement` adds one.
  const priced = pipe(
    line,
    Tuple.evolve([(name) => name.toUpperCase(), (qty) => qty * 2]),
    Tuple.appendElement(1.5),
  )
  yield* Console.log(priced)
  yield* Console.log(Tuple.get(priced, 2))
})
