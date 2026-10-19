import { exampleKey, type ExampleSummary } from '@ebe/examples'
import { Array, Effect, Option, pipe, Schema, String } from 'effect'
import { Command, Dom, Submodel, type Update } from 'foldkit'
import type { Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { modifyFields } from 'foldkit/struct'

import { type PublishedCategory, publishedCategories } from './content.ts'
import { exampleRouter } from './route.ts'

// MODEL

export const Model = Schema.Struct({
  filter: Schema.String,
  collapsedIds: Schema.Array(Schema.String),
  maybeActiveId: Schema.Option(Schema.String),
})
export type Model = typeof Model.Type

/** Starts with every category collapsed except the one being read. */
export const init = (maybeCategoryId: Option.Option<string>): Model => ({
  filter: '',
  collapsedIds: pipe(
    publishedCategories,
    Array.map((category) => category.id),
    Array.filter((id) => !Option.contains(maybeCategoryId, id)),
  ),
  maybeActiveId: Option.none(),
})

/** Expands the category of a page the reader navigated to. */
export const reveal = (model: Model, categoryId: string): Model =>
  modifyFields(model, {
    collapsedIds: (ids) => Array.filter(ids, (id) => id !== categoryId),
  })

// MESSAGE

export const Message = defineMessageUnion({
  UpdatedFilter: { value: Schema.String },
  PressedFilterKey: { key: Schema.String },
  ClickedToggle: { categoryId: Schema.String },
  PressedRowKey: { rowId: Schema.String, key: Schema.String },
  FocusedRow: { rowId: Schema.String },
  CompletedFocus: {},
})
export type Message = typeof Message.Type

export const OutMessage = defineMessageUnion({
  ChoseExample: { category: Schema.String, slug: Schema.String },
})
export type OutMessage = typeof OutMessage.Type

// ROWS

export const filterInputId = 'sidebar-filter'

type CategoryRow = {
  readonly _tag: 'Category'
  readonly id: string
  readonly category: PublishedCategory
  readonly examples: ReadonlyArray<ExampleSummary>
  readonly isExpanded: boolean
}

type ExampleRow = {
  readonly _tag: 'Example'
  readonly id: string
  readonly parentId: string
  readonly example: ExampleSummary
}

type Row = CategoryRow | ExampleRow

const categoryRowId = (categoryId: string) => `category-${categoryId}`

const exampleRowId = (example: ExampleSummary) =>
  `example-${example.category}--${example.slug}`

const rowDomId = (rowId: string) => `sidebar-row-${rowId}`

const isFiltering = (model: Model) => !String.isEmpty(model.filter.trim())

const matches = (filter: string, category: PublishedCategory) => {
  const needle = filter.trim().toLowerCase()
  return (example: ExampleSummary) =>
    [example.title, example.summary, example.slug, category.title].some(
      (text) => text.toLowerCase().includes(needle),
    )
}

const categoryRows = (model: Model): ReadonlyArray<CategoryRow> =>
  pipe(
    publishedCategories,
    Array.map((category) => ({
      _tag: 'Category' as const,
      id: categoryRowId(category.id),
      category,
      examples: isFiltering(model)
        ? Array.filter(category.examples, matches(model.filter, category))
        : category.examples,
      isExpanded:
        isFiltering(model) || !Array.contains(model.collapsedIds, category.id),
    })),
    Array.filter(
      (row) =>
        !isFiltering(model) || Array.isReadonlyArrayNonEmpty(row.examples),
    ),
  )

/** Rows in reading order, skipping the examples of collapsed categories. */
export const visibleRows = (model: Model): ReadonlyArray<Row> =>
  Array.flatMap(categoryRows(model), (row): ReadonlyArray<Row> => [
    row,
    ...(row.isExpanded
      ? Array.map(row.examples, (example) => ({
          _tag: 'Example' as const,
          id: exampleRowId(example),
          parentId: row.id,
          example,
        }))
      : []),
  ])

const firstExample = (model: Model) =>
  Array.findFirst(
    visibleRows(model),
    (row): row is ExampleRow => row._tag === 'Example',
  )

// COMMAND

export const FocusRow = Command.define('FocusRow', {
  args: { rowId: Schema.String },
  messages: [Message.CompletedFocus],
  execute: ({ rowId }) =>
    Dom.focus(`#${rowDomId(rowId)}`).pipe(
      Effect.catch(() => Effect.void),
      Effect.as(Message.CompletedFocus()),
    ),
})

export const FocusFilter = Command.define('FocusFilter', {
  messages: [Message.CompletedFocus],
  execute: Dom.focus(`#${filterInputId}`).pipe(
    Effect.andThen(
      Effect.sync(() => {
        const input = document.getElementById(filterInputId)
        if (input instanceof HTMLInputElement) {
          input.select()
        }
      }),
    ),
    Effect.catch(() => Effect.void),
    Effect.as(Message.CompletedFocus()),
  ),
})

// UPDATE

type UpdateReturn = Update.ReturnWithOutMessage<Model, Message, OutMessage>

const focusRow = (model: Model, rowId: string): UpdateReturn => ({
  model: modifyFields(model, { maybeActiveId: () => Option.some(rowId) }),
  commands: [FocusRow({ rowId })],
})

/** Lets the parent move focus to the filter, for example on Cmd+K. */
export const focusFilter = (model: Model): Update.Return<Model, Message> => ({
  model,
  commands: [FocusFilter()],
})

const toggle = (model: Model, categoryId: string): Model =>
  modifyFields(model, {
    collapsedIds: (ids) =>
      Array.contains(ids, categoryId)
        ? Array.filter(ids, (id) => id !== categoryId)
        : Array.append(ids, categoryId),
  })

const navigateFromRow = (
  model: Model,
  rowId: string,
  key: string,
): UpdateReturn => {
  const rows = visibleRows(model)
  return Option.match(
    Array.findFirstIndex(rows, (row) => row.id === rowId),
    {
      onNone: () => ({ model }),
      onSome: (index) => {
        const row = rows[index]
        const moveTo = (target: Option.Option<Row>) =>
          Option.match(target, {
            onNone: () => ({ model }),
            onSome: (next: Row) => focusRow(model, next.id),
          })
        if (key === 'ArrowDown') {
          return moveTo(Array.get(rows, index + 1))
        }
        if (key === 'ArrowUp') {
          return index === 0
            ? focusFilter(model)
            : moveTo(Array.get(rows, index - 1))
        }
        if (key === 'Home') {
          return moveTo(Array.head(rows))
        }
        if (key === 'End') {
          return moveTo(Array.last(rows))
        }
        if (row?._tag === 'Category' && key === 'ArrowRight') {
          return row.isExpanded
            ? moveTo(Array.get(rows, index + 1))
            : focusRow(toggle(model, row.category.id), row.id)
        }
        if (row?._tag === 'Category' && key === 'ArrowLeft') {
          return row.isExpanded && !isFiltering(model)
            ? focusRow(toggle(model, row.category.id), row.id)
            : { model }
        }
        if (row?._tag === 'Example' && key === 'ArrowLeft') {
          return focusRow(model, row.parentId)
        }
        return { model }
      },
    },
  )
}

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    UpdatedFilter: ({ value }) => ({
      model: modifyFields(model, {
        filter: () => value,
        maybeActiveId: () => Option.none(),
      }),
    }),
    PressedFilterKey: ({ key }) => {
      if (key === 'ArrowDown') {
        return Option.match(Array.head(visibleRows(model)), {
          onNone: () => ({ model }),
          onSome: (row) => focusRow(model, row.id),
        })
      }
      if (key === 'Enter') {
        return Option.match(firstExample(model), {
          onNone: () => ({ model }),
          onSome: (row) => ({
            model,
            outMessage: OutMessage.ChoseExample({
              category: row.example.category,
              slug: row.example.slug,
            }),
          }),
        })
      }
      if (key === 'Escape') {
        return {
          model: modifyFields(model, { filter: () => '' }),
        }
      }
      return { model }
    },
    ClickedToggle: ({ categoryId }) =>
      isFiltering(model) ? { model } : { model: toggle(model, categoryId) },
    PressedRowKey: ({ rowId, key }) => navigateFromRow(model, rowId, key),
    FocusedRow: ({ rowId }) => ({
      model: modifyFields(model, { maybeActiveId: () => Option.some(rowId) }),
    }),
    CompletedFocus: () => ({ model }),
  })

// VIEW

export type ViewInputs = Readonly<{
  maybeCurrentKey: Option.Option<string>
  shortcutLabel: string
}>

const navigationKeys = [
  'ArrowDown',
  'ArrowUp',
  'ArrowLeft',
  'ArrowRight',
  'Home',
  'End',
]

const rowKeyHandler = (rowId: string, h: HtmlBuilder<Message>) =>
  h.OnKeyDownPreventDefault((key, modifiers) =>
    Array.contains(navigationKeys, key) &&
    !modifiers.altKey &&
    !modifiers.metaKey &&
    !modifiers.ctrlKey
      ? Option.some(Message.PressedRowKey({ rowId, key }))
      : Option.none(),
  )

const tabStop = (
  rows: ReadonlyArray<Row>,
  model: Model,
  inputs: ViewInputs,
) => {
  const isVisible = (id: string) => Array.some(rows, (row) => row.id === id)
  const current = Option.flatMap(inputs.maybeCurrentKey, (key) =>
    pipe(
      rows,
      Array.findFirst(
        (row) =>
          row._tag === 'Example' &&
          exampleKey(row.example.category, row.example.slug) === key,
      ),
      Option.map((row) => row.id),
    ),
  )
  return pipe(
    model.maybeActiveId,
    Option.filter(isVisible),
    Option.orElse(() => current),
    Option.orElse(() => Option.map(Array.head(rows), (row) => row.id)),
  )
}

const rowAttributes = (
  rowId: string,
  maybeTabStop: Option.Option<string>,
  h: HtmlBuilder<Message>,
) => [
  h.Id(rowDomId(rowId)),
  h.Tabindex(Option.contains(maybeTabStop, rowId) ? 0 : -1),
  h.OnFocus(Message.FocusedRow({ rowId })),
  rowKeyHandler(rowId, h),
]

const exampleRowView = (
  row: ExampleRow,
  maybeTabStop: Option.Option<string>,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
) => {
  const isCurrent = Option.contains(
    inputs.maybeCurrentKey,
    exampleKey(row.example.category, row.example.slug),
  )
  return h.keyed('li')(
    row.id,
    [],
    [
      h.a(
        [
          ...rowAttributes(row.id, maybeTabStop, h),
          h.Class(
            isCurrent ? 'sidebar-link sidebar-link-current' : 'sidebar-link',
          ),
          h.Href(
            exampleRouter({
              category: row.example.category,
              slug: row.example.slug,
            }),
          ),
          ...(isCurrent ? [h.AriaCurrent('page')] : []),
        ],
        [row.example.title],
      ),
    ],
  )
}

const categoryView = (
  row: CategoryRow,
  model: Model,
  maybeTabStop: Option.Option<string>,
  inputs: ViewInputs,
  h: HtmlBuilder<Message>,
) => {
  const listId = `sidebar-list-${row.category.id}`
  return h.keyed('li')(
    row.id,
    [h.Class('sidebar-category')],
    [
      h.button(
        [
          ...rowAttributes(row.id, maybeTabStop, h),
          h.Type('button'),
          h.Class('sidebar-toggle'),
          h.AriaExpanded(row.isExpanded),
          h.AriaControls(listId),
          h.OnClick(Message.ClickedToggle({ categoryId: row.category.id })),
        ],
        [
          h.span(
            [h.Class('sidebar-chevron'), h.AriaHidden(true)],
            [row.isExpanded ? '▾' : '▸'],
          ),
          h.span([h.Class('sidebar-category-title')], [row.category.title]),
          h.span([h.Class('sidebar-count')], [`${row.examples.length}`]),
        ],
      ),
      row.isExpanded
        ? h.ul(
            [h.Id(listId), h.Class('sidebar-list')],
            Array.map(row.examples, (example) =>
              exampleRowView(
                {
                  _tag: 'Example',
                  id: exampleRowId(example),
                  parentId: row.id,
                  example,
                },
                maybeTabStop,
                inputs,
                h,
              ),
            ),
          )
        : h.empty,
    ],
  )
}

const emptyView = (model: Model, h: HtmlBuilder<Message>) =>
  h.p(
    [h.Class('sidebar-empty')],
    [`No examples match “${model.filter.trim()}”.`],
  )

export const view = Submodel.defineView<Model, Message, ViewInputs>(
  (model, inputs, h): Html => {
    const rows = visibleRows(model)
    const maybeTabStop = tabStop(rows, model, inputs)
    return h.nav(
      [h.Class('sidebar'), h.AriaLabel('Examples')],
      [
        h.div(
          [h.Class('sidebar-filter')],
          [
            h.input([
              h.Id(filterInputId),
              h.Type('search'),
              h.Class('sidebar-filter-input'),
              h.Placeholder('Filter examples'),
              h.AriaLabel('Filter examples'),
              h.AriaKeyshortcuts(
                inputs.shortcutLabel === '⌘K' ? 'Meta+K' : 'Control+K',
              ),
              h.Autocomplete('off'),
              h.Value(model.filter),
              h.OnInput((value) => Message.UpdatedFilter({ value })),
              h.OnKeyDownPreventDefault((key) =>
                key === 'ArrowDown' ||
                key === 'Enter' ||
                (key === 'Escape' && isFiltering(model))
                  ? Option.some(Message.PressedFilterKey({ key }))
                  : Option.none(),
              ),
            ]),
            h.kbd(
              [h.Class('sidebar-shortcut'), h.AriaHidden(true)],
              [inputs.shortcutLabel],
            ),
          ],
        ),
        Array.match(categoryRows(model), {
          onEmpty: () => emptyView(model, h),
          onNonEmpty: (categories) =>
            h.ul(
              [h.Class('sidebar-categories')],
              Array.map(categories, (row) =>
                categoryView(row, model, maybeTabStop, inputs, h),
              ),
            ),
        }),
      ],
    )
  },
)
