import type { ExamplePage } from '@ebe/examples'
import { Effect, Option } from 'effect'
import { Url } from 'foldkit'
import { Command, given, message, model, story } from 'foldkit/story'
import { expect, test } from 'vitest'

import { loadPage, publishedCategories } from './content.ts'
import {
  CopyState,
  LoadPage,
  Message,
  type Model,
  RunExample,
  Navigate,
  PageState,
  RunState,
  ScrollToTop,
  update,
} from './main.ts'
import { AppRoute } from './route.ts'
import * as Sidebar from './sidebar.ts'

const pageOf = (slug: string): ExamplePage => ({
  example: {
    category: 'schema',
    slug,
    title: slug,
    difficulty: 'beginner',
    runtime: 'browser',
    summary: '',
    segments: [],
    source: '',
  },
  maybeHistory: Option.none(),
  maybeOutput: Option.none(),
})

const onExample = (slug: string): Model => ({
  route: AppRoute.Example({ category: 'schema', slug }),
  page: PageState.Loaded({ page: pageOf(slug) }),
  run: RunState.Idle(),
  copy: CopyState.Ready(),
  sidebar: Sidebar.init(Option.some('schema')),
  shortcutLabel: '⌘K',
})

const finished = Message.CompletedRunExample({
  key: 'schema/defining-a-schema',
  output: { outcome: 'succeeded', lines: [{ level: 'log', text: 'true' }] },
})

test('every published Schema example is loaded from its source file', () => {
  const schema = publishedCategories.find(
    (category) => category.id === 'schema',
  )
  expect(schema?.examples.map((example) => example.slug)).toEqual(schema?.slugs)
})

test('every example page loads and decodes', async () => {
  const keys = publishedCategories.flatMap((category) =>
    category.examples.map((example) => `${category.id}/${example.slug}`),
  )
  const pages = await Effect.runPromise(
    Effect.forEach(keys, (key) => Option.getOrThrow(loadPage(key))),
  )
  expect(
    pages.map(({ example }) => `${example.category}/${example.slug}`),
  ).toEqual(keys)
})

test('running an example shows its output', () => {
  story(
    update,
    given(onExample('defining-a-schema')),
    message(Message.ClickedRun()),
    model((value) => expect(value.run._tag).toBe('Running')),
    Command.resolve(RunExample, finished),
    model((value) => {
      expect(value.run).toEqual(RunState.Finished({ output: finished.output }))
    }),
    message(Message.ClickedClearOutput()),
    model((value) => expect(value.run._tag).toBe('Idle')),
  )
})

test('output from a previous page is ignored after navigating away', () => {
  story(
    update,
    given({ ...onExample('checks'), run: RunState.Running() }),
    message(finished),
    Command.expectNone(),
    model((value) => expect(value.run._tag).toBe('Running')),
  )
})

test('changing pages resets the run and scrolls to the top', () => {
  const url = Option.getOrThrow(
    Url.fromString('https://example.test/schema/checks'),
  )
  story(
    update,
    given({
      ...onExample('defining-a-schema'),
      run: RunState.Finished({ output: finished.output }),
    }),
    message(Message.ChangedUrl({ url })),
    Command.expectExact(ScrollToTop(), LoadPage({ key: 'schema/checks' })),
    model((value) => {
      expect(value.route).toEqual(
        AppRoute.Example({ category: 'schema', slug: 'checks' }),
      )
      expect(value.run._tag).toBe('Idle')
    }),
    Command.resolve(ScrollToTop, Message.CompletedScrollToTop()),
    model((value) =>
      expect(value.page).toEqual(PageState.Loading({ key: 'schema/checks' })),
    ),
    Command.resolve(
      LoadPage,
      Message.SucceededLoadPage({
        key: 'schema/checks',
        page: pageOf('checks'),
      }),
    ),
    model((value) =>
      expect(value.page).toEqual(PageState.Loaded({ page: pageOf('checks') })),
    ),
  )
})

test('a page that arrives after navigating away is ignored', () => {
  story(
    update,
    given({
      ...onExample('checks'),
      page: PageState.Loading({ key: 'schema/checks' }),
    }),
    message(
      Message.SucceededLoadPage({
        key: 'schema/defining-a-schema',
        page: pageOf('defining-a-schema'),
      }),
    ),
    model((value) =>
      expect(value.page).toEqual(PageState.Loading({ key: 'schema/checks' })),
    ),
    message(Message.FailedLoadPage({ key: 'schema/checks' })),
    model((value) =>
      expect(value.page).toEqual(PageState.Failed({ key: 'schema/checks' })),
    ),
  )
})

test('Cmd+K focuses the sidebar filter', () => {
  story(
    update,
    given(onExample('checks')),
    message(Message.PressedFilterShortcut()),
    Command.expectExact(Sidebar.FocusFilter()),
    Command.resolve(Sidebar.FocusFilter, Sidebar.Message.CompletedFocus()),
  )
})

test('pressing Enter in the filter opens the first match', () => {
  story(
    update,
    given({
      ...onExample('checks'),
      sidebar: { ...Sidebar.init(Option.none()), filter: 'branded-types' },
    }),
    message(
      Message.GotSidebarMessage({
        message: Sidebar.Message.PressedFilterKey({ key: 'Enter' }),
      }),
    ),
    Command.expectExact(Navigate({ url: '/schema/branded-types' })),
    Command.resolve(Navigate, Message.CompletedNavigate()),
  )
})
