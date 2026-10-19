import { Option } from 'effect'
import { Command, given, message, model, story } from 'foldkit/story'
import { expect, test } from 'vitest'

import { publishedCategories } from './content.ts'
import {
  FocusFilter,
  FocusRow,
  init,
  Message,
  type Model,
  OutMessage,
  update,
  visibleRows,
} from './sidebar.ts'

const firstExample = 'example-schema--defining-a-schema'
const secondExample = 'example-schema--primitives-and-literals'
const schemaRow = 'category-schema'
const firstCategoryRow = `category-${publishedCategories[0]?.id}`

const schemaExampleRows = (model: Model) =>
  visibleRows(model).filter((row) => row.id.startsWith('example-schema--'))

const focused = (rowId: string) =>
  Command.resolve(FocusRow({ rowId }), Message.CompletedFocus())

test('only the current category starts expanded', () => {
  const rows = visibleRows(init(Option.some('schema')))
  expect(rows.filter((row) => row._tag === 'Category')).toHaveLength(
    publishedCategories.length,
  )
  expect(rows.filter((row) => row._tag === 'Example')).toHaveLength(
    publishedCategories.find((category) => category.id === 'schema')?.examples
      .length ?? 0,
  )
})

test('rows list each category followed by its examples', () => {
  const rows = visibleRows({ ...init(Option.none()), collapsedIds: [] })
  const [first] = publishedCategories
  expect(rows[0]?.id).toBe(firstCategoryRow)
  expect(rows[1]?.id).toBe(`example-${first?.id}--${first?.slugs[0]}`)
  expect(rows).toHaveLength(
    publishedCategories.reduce(
      (count, category) => count + 1 + category.examples.length,
      0,
    ),
  )
})

test('arrow keys move between rows, and up from the top returns to the filter', () => {
  story(
    update,
    given(init(Option.some('schema'))),
    message(Message.PressedRowKey({ rowId: firstExample, key: 'ArrowDown' })),
    Command.expectExact(FocusRow({ rowId: secondExample })),
    focused(secondExample),
    model((value) =>
      expect(value.maybeActiveId).toEqual(Option.some(secondExample)),
    ),
    message(Message.PressedRowKey({ rowId: firstCategoryRow, key: 'ArrowUp' })),
    Command.expectExact(FocusFilter()),
    Command.resolve(FocusFilter, Message.CompletedFocus()),
  )
})

test('left on an example jumps to its category, left again collapses it', () => {
  story(
    update,
    given(init(Option.some('schema'))),
    message(Message.PressedRowKey({ rowId: secondExample, key: 'ArrowLeft' })),
    focused(schemaRow),
    message(Message.PressedRowKey({ rowId: schemaRow, key: 'ArrowLeft' })),
    focused(schemaRow),
    model((value: Model) => {
      expect(value.collapsedIds).toContain('schema')
      expect(schemaExampleRows(value)).toEqual([])
    }),
    message(Message.PressedRowKey({ rowId: schemaRow, key: 'ArrowRight' })),
    focused(schemaRow),
    model((value) => expect(value.collapsedIds).not.toContain('schema')),
    message(Message.PressedRowKey({ rowId: schemaRow, key: 'ArrowRight' })),
    focused(firstExample),
  )
})

test('clicking a category toggles it', () => {
  story(
    update,
    given(init(Option.some('schema'))),
    message(Message.ClickedToggle({ categoryId: 'schema' })),
    model((value) => expect(value.collapsedIds).toContain('schema')),
    message(Message.ClickedToggle({ categoryId: 'schema' })),
    model((value) => expect(value.collapsedIds).not.toContain('schema')),
  )
})

test('filtering shows matches, even inside a collapsed category', () => {
  story(
    update,
    given(init(Option.none())),
    message(Message.UpdatedFilter({ value: 'json-strings' })),
    model((value) =>
      expect(visibleRows(value).map((row) => row.id)).toEqual([
        schemaRow,
        'example-schema--json-strings',
      ]),
    ),
    message(Message.PressedFilterKey({ key: 'ArrowDown' })),
    focused(schemaRow),
    message(Message.PressedFilterKey({ key: 'Escape' })),
    model((value) => {
      expect(value.filter).toBe('')
      expect(schemaExampleRows(value)).toEqual([])
    }),
  )
})

test('a filter with no matches leaves nothing to open', () => {
  story(
    update,
    given({ ...init(Option.some('schema')), filter: 'no such example' }),
    model((value) => expect(visibleRows(value)).toEqual([])),
    message(Message.PressedFilterKey({ key: 'Enter' })),
    Command.expectNone(),
  )
})

test('Enter in the filter asks the parent to open the first match', () => {
  const result = update(
    { ...init(Option.some('schema')), filter: 'tagged-unions' },
    Message.PressedFilterKey({ key: 'Enter' }),
  )
  expect(result.outMessage).toEqual(
    OutMessage.ChoseExample({ category: 'schema', slug: 'tagged-unions' }),
  )
})
