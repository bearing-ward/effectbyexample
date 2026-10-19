/**
 * @title Byte sizes
 * @difficulty beginner
 * @summary Upload limits, quotas, and cache sizes are easy to get wrong when
 * they are bare numbers: was that kilobytes or kibibytes? `ByteSize` stores
 * an exact count of bytes and makes the unit explicit when you create,
 * parse, and print one.
 */

import { ByteSize, Console, Effect } from 'effect'

// `ByteSize` is marked unstable in Effect 4.0, so its API may change.

// Constructors name the unit. Decimal units (`megabytes`, MB) are powers of
// 1000; binary units (`mebibytes`, MiB) are powers of 1024. Underneath, a
// byte size is a `bigint` count of bytes.
const uploadLimit = ByteSize.megabytes(25)
const mebibyte = ByteSize.mebibytes(1)

export const program = Effect.gen(function* () {
  yield* Console.log(uploadLimit, mebibyte)

  // `format` picks a readable unit. Without options it uses binary units,
  // so pass `system: 'decimal'` when you want MB and kB.
  yield* Console.log(ByteSize.format(uploadLimit))
  yield* Console.log(ByteSize.format(uploadLimit, { system: 'decimal' }))

  // `fromString` parses user input or config, returning an `Option`. It
  // accepts unit symbols and names, and rejects anything that is not a whole,
  // non-negative number of bytes.
  const inputs = [
    '1.5 MB',
    '1.5 MiB',
    '2 megabytes',
    '0.5 B',
    '-1 kB',
    '10 parsecs',
  ]
  for (const input of inputs) {
    yield* Console.log(input.padEnd(12), ByteSize.fromString(input))
  }

  // Arithmetic stays exact. `ReducerSum` adds up a list, and comparisons
  // work across units because everything is bytes underneath.
  const attachments = [
    ByteSize.megabytes(12),
    ByteSize.kilobytes(800),
    ByteSize.fromStringUnsafe('14.2 MB'),
  ]
  const total = ByteSize.ReducerSum.combineAll(attachments)
  yield* Console.log('total:', ByteSize.format(total, { system: 'decimal' }))
  yield* Console.log(
    'over the limit:',
    ByteSize.isGreaterThan(total, uploadLimit),
  )

  // Operations that could leave the valid range return an `Option`. A byte
  // size can never be negative, so this subtraction gives `None`.
  yield* Console.log('room left:', ByteSize.subtract(uploadLimit, total))
})
