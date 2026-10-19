import { Option } from 'effect'
import { expect, test } from 'vitest'

import { formatArguments, formatValue } from './format.ts'

test('prints top-level strings bare and nested strings quoted', () => {
  expect(formatValue('hi')).toBe('hi')
  expect(formatValue(['hi'])).toBe("[ 'hi' ]")
})

test('prints objects inline when short and wrapped when long', () => {
  expect(formatValue({ a: 1, 'b-c': true, d: null })).toBe(
    "{ a: 1, 'b-c': true, d: null }",
  )
  expect(
    formatValue({
      description: 'a fairly long string value',
      another: 'and another long one',
    }),
  ).toBe(
    "{\n  description: 'a fairly long string value',\n  another: 'and another long one'\n}",
  )
})

test('prints class instances with their name and Effect data via toJSON', () => {
  class Point {
    constructor(
      readonly x: number,
      readonly y: number,
    ) {}
  }
  expect(formatValue(new Point(1, 2))).toBe('Point { x: 1, y: 2 }')
  expect(formatValue(Option.some(1))).toBe(
    "{ _id: 'Option', _tag: 'Some', value: 1 }",
  )
})

test('joins arguments with spaces like console.log', () => {
  expect(formatArguments([true, 'five', 5n])).toBe('true five 5n')
})

test('prints objects without a constructor, such as null-prototype records', () => {
  const params = Object.create(Object.create(null))
  params.id = '42'
  expect(formatValue(params)).toBe("{ id: '42' }")
  expect(formatValue(Object.assign(Object.create(null), { id: '7' }))).toBe(
    "{ id: '7' }",
  )
})
