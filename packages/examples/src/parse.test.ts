import { expect, test } from 'vitest'

import { parseExample } from './parse.ts'

const source = `/**
 * @title Hello
 * @difficulty beginner
 * @summary Says hello
 * across two lines.
 */

// Import things.
import { Console } from 'effect'

// Define a value.
// It spans two comment lines.
const greeting = 'hi'
const other = () => {
  // Indented comments start a new segment too.
  return greeting
}

export const program = Console.log(other())
`

test('reads the header and pairs prose with the code that follows it', () => {
  const example = parseExample('demo', 'hello', source)
  expect(example.title).toBe('Hello')
  expect(example.difficulty).toBe('beginner')
  expect(example.summary).toBe('Says hello across two lines.')
  expect(example.segments).toEqual([
    { prose: 'Import things.', code: "import { Console } from 'effect'" },
    {
      prose: 'Define a value. It spans two comment lines.',
      code: "const greeting = 'hi'\nconst other = () => {",
    },
    {
      prose: 'Indented comments start a new segment too.',
      code: '  return greeting\n}\n\nexport const program = Console.log(other())',
    },
  ])
  expect(example.source.startsWith('// Import things.')).toBe(true)
})

test('rejects a file without a header', () => {
  expect(() => parseExample('demo', 'bad', 'const x = 1')).toThrow(/header/u)
})

test('rejects an unknown difficulty', () => {
  expect(() =>
    parseExample(
      'demo',
      'bad',
      '/**\n * @title X\n * @difficulty expert\n * @summary Y\n */\n',
    ),
  ).toThrow()
})
