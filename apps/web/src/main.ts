import {
  effectVersion,
  type ExampleHistory,
  exampleKey,
  ExamplePage,
  type ExampleSummary,
  Output,
  type OutputLine,
  runProgram,
  type Segment,
  type Stability,
} from '@ebe/examples'
import { highlight } from '@foldworks/code-editor'
import { AppHeader, Badge, Breadcrumb, Button, CodeBlock } from '@foldworks/ui'
import { Array, Effect, Option, pipe, Schema } from 'effect'
import { Command, Dom, type Runtime, Subscription, Update } from 'foldkit'
import type { Document, Html, HtmlBuilder } from 'foldkit/html'
import { defineMessageUnion } from 'foldkit/message'
import { load, pushUrl, UrlRequest } from 'foldkit/navigation'
import { defineTaggedUnion } from 'foldkit/schema'
import { modifyFields } from 'foldkit/struct'
import { toString as urlToString, Url } from 'foldkit/url'

import {
  exampleCount,
  findCategory,
  findExample,
  loadPage,
  loadProgram,
  neighboursOf,
  plannedCategories,
  type PublishedCategory,
  publishedCategories,
} from './content.ts'
import * as Sidebar from './sidebar.ts'
import { AppRoute, exampleRouter, homeRouter, urlToAppRoute } from './route.ts'

// MODEL

export const RunState = defineTaggedUnion({
  Idle: {},
  Running: {},
  Finished: { output: Output },
})
export type RunState = typeof RunState.Type

export const CopyState = defineTaggedUnion({ Ready: {}, Copied: {} })
export type CopyState = typeof CopyState.Type

// An example's prose, code, history, and recorded output load when its page
// opens. `None` is every page that is not an example.
export const PageState = defineTaggedUnion({
  None: {},
  Loading: { key: Schema.String },
  Loaded: { page: ExamplePage },
  Failed: { key: Schema.String },
})
export type PageState = typeof PageState.Type

export const Model = Schema.Struct({
  route: AppRoute,
  page: PageState,
  run: RunState,
  copy: CopyState,
  sidebar: Sidebar.Model,
  shortcutLabel: Schema.String,
})
export type Model = typeof Model.Type

// MESSAGE

export const Message = defineMessageUnion({
  ClickedLink: { request: UrlRequest },
  ChangedUrl: { url: Url },
  CompletedNavigate: {},
  CompletedLoadExternal: {},
  CompletedScrollToTop: {},
  SucceededLoadPage: { key: Schema.String, page: ExamplePage },
  FailedLoadPage: { key: Schema.String },
  ClickedRun: {},
  CompletedRunExample: { key: Schema.String, output: Output },
  ClickedClearOutput: {},
  ClickedCopySource: {},
  CompletedCopySource: { key: Schema.String, isCopied: Schema.Boolean },
  CompletedWaitBeforeResetCopy: {},
  PressedFilterShortcut: {},
  GotSidebarMessage: { message: Sidebar.Message },
})
export type Message = typeof Message.Type

// FLAGS

export const Flags = Schema.Struct({ shortcutLabel: Schema.String })
export type Flags = typeof Flags.Type

// INIT

const routeCategory = (route: AppRoute) =>
  route._tag === 'Example' ? Option.some(route.category) : Option.none()

const pageKey = (page: PageState) =>
  PageState.match(page, {
    None: () => Option.none<string>(),
    Loading: ({ key }) => Option.some(key),
    Loaded: ({ page: { example } }) =>
      Option.some(exampleKey(example.category, example.slug)),
    Failed: ({ key }) => Option.some(key),
  })

/** The page state for a route, and the key to load if it is not loaded yet. */
const openPage = (route: AppRoute, page: PageState) =>
  Option.match(
    route._tag === 'Example'
      ? Option.map(findExample(route.category, route.slug), (example) =>
          exampleKey(example.category, example.slug),
        )
      : Option.none(),
    {
      onNone: () => ({
        page: PageState.None(),
        maybeKeyToLoad: Option.none<string>(),
      }),
      onSome: (key) =>
        Option.contains(pageKey(page), key) && page._tag !== 'Failed'
          ? { page, maybeKeyToLoad: Option.none<string>() }
          : {
              page: PageState.Loading({ key }),
              maybeKeyToLoad: Option.some(key),
            },
    },
  )

export const init: Runtime.RoutingApplicationInit<Model, Message, Flags> = (
  flags,
  url,
) => {
  const route = urlToAppRoute(url)
  const opened = openPage(route, PageState.None())
  const model: Model = {
    route,
    page: opened.page,
    run: RunState.Idle(),
    copy: CopyState.Ready(),
    sidebar: Sidebar.init(routeCategory(route)),
    shortcutLabel: flags.shortcutLabel,
  }
  return Option.match(opened.maybeKeyToLoad, {
    onNone: () => ({ model }),
    onSome: (key) => ({ model, commands: [LoadPage({ key })] }),
  })
}

// COMMAND

export const Navigate = Command.define('Navigate', {
  args: { url: Schema.String },
  messages: [Message.CompletedNavigate],
  execute: ({ url }) =>
    pushUrl(url).pipe(Effect.as(Message.CompletedNavigate())),
})

const LoadExternal = Command.define('LoadExternal', {
  args: { href: Schema.String },
  messages: [Message.CompletedLoadExternal],
  execute: ({ href }) =>
    load(href).pipe(Effect.as(Message.CompletedLoadExternal())),
})

export const ScrollToTop = Command.define('ScrollToTop', {
  messages: [Message.CompletedScrollToTop],
  execute: Dom.scrollIntoViewAfterPaint('#top', { block: 'start' }).pipe(
    Effect.catch(() => Effect.void),
    Effect.as(Message.CompletedScrollToTop()),
  ),
})

export const LoadPage = Command.define('LoadPage', {
  args: { key: Schema.String },
  messages: [Message.SucceededLoadPage, Message.FailedLoadPage],
  execute: ({ key }) =>
    Option.match(loadPage(key), {
      onNone: () => Effect.succeed(Message.FailedLoadPage({ key })),
      onSome: (load) =>
        load.pipe(
          Effect.map((page) => Message.SucceededLoadPage({ key, page })),
          Effect.catch(() => Effect.succeed(Message.FailedLoadPage({ key }))),
        ),
    }),
})

const failedToLoad: Output = {
  outcome: 'failed',
  lines: [{ level: 'error', text: 'This example could not be loaded.' }],
}

const missingProgram: Output = {
  outcome: 'failed',
  lines: [{ level: 'error', text: 'This example has no runnable program.' }],
}

export const RunExample = Command.define('RunExample', {
  args: { key: Schema.String },
  messages: [Message.CompletedRunExample],
  execute: ({ key }) =>
    pipe(
      loadProgram(key),
      Option.match({
        onNone: () => Effect.succeed(missingProgram),
        onSome: (load) =>
          Effect.tryPromise(load).pipe(
            Effect.flatMap(runProgram),
            Effect.catch(() => Effect.succeed(failedToLoad)),
          ),
      }),
      Effect.map((output) => Message.CompletedRunExample({ key, output })),
    ),
})

export const CopySource = Command.define('CopySource', {
  args: { key: Schema.String, source: Schema.String },
  messages: [Message.CompletedCopySource],
  execute: ({ key, source }) =>
    CodeBlock.writeClipboard(source).pipe(
      Effect.map((isCopied) => Message.CompletedCopySource({ key, isCopied })),
    ),
})

const WaitBeforeResetCopy = Command.define('WaitBeforeResetCopy', {
  messages: [Message.CompletedWaitBeforeResetCopy],
  execute: Effect.sleep('1500 millis').pipe(
    Effect.as(Message.CompletedWaitBeforeResetCopy()),
  ),
})

// UPDATE

type UpdateReturn = Update.Return<Model, Message>

const currentKey = (route: AppRoute) =>
  route._tag === 'Example'
    ? Option.some(exampleKey(route.category, route.slug))
    : Option.none()

const isCurrent = (model: Model, key: string) =>
  Option.contains(currentKey(model.route), key)

const foldSidebar = Update.foldChild({
  update: Sidebar.update,
  read: (model: Model) => Option.some(model.sidebar),
  write: (model, nextSidebar) =>
    modifyFields(model, { sidebar: () => nextSidebar }),
  toParentMessage: (message) => Message.GotSidebarMessage({ message }),
  foldOutMessage: Sidebar.OutMessage.match<Update.Step<Model, Message>>({
    ChoseExample:
      ({ category, slug }) =>
      (model) => ({
        model,
        commands: [Navigate({ url: exampleRouter({ category, slug }) })],
      }),
  }),
})

const foldSidebarFocus = Update.foldChildStep({
  update: Sidebar.focusFilter,
  read: (model: Model) => Option.some(model.sidebar),
  write: (model, nextSidebar) =>
    modifyFields(model, { sidebar: () => nextSidebar }),
  toParentMessage: (message) => Message.GotSidebarMessage({ message }),
})

export const update = (model: Model, message: Message) =>
  Message.match<UpdateReturn>(message, {
    ClickedLink: ({ request }) =>
      UrlRequest.match<UpdateReturn>(request, {
        Internal: ({ url }) => ({
          model,
          commands: [Navigate({ url: urlToString(url) })],
        }),
        External: ({ href }) => ({ model, commands: [LoadExternal({ href })] }),
      }),
    ChangedUrl: ({ url }) => {
      const route = urlToAppRoute(url)
      const opened = openPage(route, model.page)
      return {
        model: modifyFields(model, {
          route: () => route,
          page: () => opened.page,
          sidebar: (sidebar) =>
            Option.match(routeCategory(route), {
              onNone: () => sidebar,
              onSome: (categoryId) => Sidebar.reveal(sidebar, categoryId),
            }),
          run: () => RunState.Idle(),
          copy: () => CopyState.Ready(),
        }),
        commands: [
          ScrollToTop(),
          ...Option.toArray(
            Option.map(opened.maybeKeyToLoad, (key) => LoadPage({ key })),
          ),
        ],
      }
    },
    CompletedNavigate: () => ({ model }),
    CompletedLoadExternal: () => ({ model }),
    CompletedScrollToTop: () => ({ model }),
    SucceededLoadPage: ({ key, page }) =>
      Option.contains(pageKey(model.page), key) && model.page._tag === 'Loading'
        ? {
            model: modifyFields(model, {
              page: () => PageState.Loaded({ page }),
            }),
          }
        : { model },
    FailedLoadPage: ({ key }) =>
      Option.contains(pageKey(model.page), key) && model.page._tag === 'Loading'
        ? {
            model: modifyFields(model, {
              page: () => PageState.Failed({ key }),
            }),
          }
        : { model },
    ClickedRun: () =>
      Option.match(currentKey(model.route), {
        onNone: () => ({ model }),
        onSome: (key) => ({
          model: modifyFields(model, { run: () => RunState.Running() }),
          commands: [RunExample({ key })],
        }),
      }),
    CompletedRunExample: ({ key, output }) =>
      isCurrent(model, key)
        ? {
            model: modifyFields(model, {
              run: () => RunState.Finished({ output }),
            }),
          }
        : { model },
    ClickedClearOutput: () => ({
      model: modifyFields(model, { run: () => RunState.Idle() }),
    }),
    ClickedCopySource: () =>
      PageState.match(model.page, {
        Loaded: ({ page: { example } }) => ({
          model,
          commands: [
            CopySource({
              key: exampleKey(example.category, example.slug),
              source: example.source,
            }),
          ],
        }),
        None: () => ({ model }),
        Loading: () => ({ model }),
        Failed: () => ({ model }),
      }),
    CompletedCopySource: ({ key, isCopied }) =>
      isCopied && isCurrent(model, key)
        ? {
            model: modifyFields(model, { copy: () => CopyState.Copied() }),
            commands: [WaitBeforeResetCopy()],
          }
        : { model },
    CompletedWaitBeforeResetCopy: () => ({
      model: modifyFields(model, { copy: () => CopyState.Ready() }),
    }),
    PressedFilterShortcut: () => foldSidebarFocus(model),
    GotSidebarMessage: ({ message: child }) => foldSidebar(model, child),
  })

// SUBSCRIPTION

export const subscriptions = Subscription.make<Model, Message>()(() => ({
  filterShortcut: Subscription.persistent(
    Subscription.keyBindings<Message>({
      bindings: [
        {
          keys: 'Mod+K',
          mapEvent: () => Message.PressedFilterShortcut(),
          whileTyping: 'Allow',
          preventDefault: true,
        },
      ],
    }),
  ),
}))

// VIEW

const exampleHref = (example: ExampleSummary) =>
  exampleRouter({ category: example.category, slug: example.slug })

const difficultyTone = {
  beginner: 'success',
  intermediate: 'info',
  advanced: 'warning',
} as const

const difficultyBadge = (example: ExampleSummary, h: HtmlBuilder<Message>) =>
  Badge.view(
    {
      label: example.difficulty,
      tone: difficultyTone[example.difficulty],
      variant: 'outline',
    },
    h,
  )

const stabilityBadge = (stability: Stability, h: HtmlBuilder<Message>) =>
  stability === 'unstable'
    ? h.span(
        [
          h.Class('stability-badge'),
          h.Title(
            'This Effect module is marked unstable. Its API may change in a minor release.',
          ),
        ],
        [
          Badge.view(
            { label: 'unstable API', tone: 'warning', variant: 'subtle' },
            h,
          ),
        ],
      )
    : h.empty

const inlineCodeView = (text: string, h: HtmlBuilder<Message>) =>
  Array.map(text.split('`'), (part, index) =>
    index % 2 === 1 ? h.code([h.Class('inline-code')], [part]) : part,
  )

const headerView = (h: HtmlBuilder<Message>) =>
  AppHeader.view(
    {
      title: 'Effect by Example',
      titleHref: homeRouter(),
      leading: [h.span([h.Class('brand-mark'), h.AriaHidden(true)], ['E'])],
      status: [
        Badge.view(
          { label: `effect ${effectVersion}`, tone: 'muted', mono: true },
          h,
        ),
      ],
      actions: [
        h.a(
          [h.Class('header-link'), h.Href('https://effect.website/docs')],
          ['Effect docs'],
        ),
      ],
      sticky: true,
    },
    h,
  )

const exampleCardView = (example: ExampleSummary, h: HtmlBuilder<Message>) =>
  h.keyed('li')(
    exampleKey(example.category, example.slug),
    [],
    [
      h.a(
        [h.Class('example-card'), h.Href(exampleHref(example))],
        [
          h.div(
            [h.Class('example-card-heading')],
            [
              h.span([h.Class('example-card-title')], [example.title]),
              difficultyBadge(example, h),
            ],
          ),
          h.p(
            [h.Class('example-card-summary')],
            inlineCodeView(example.summary, h),
          ),
        ],
      ),
    ],
  )

const publishedCategoryView = (
  category: PublishedCategory,
  h: HtmlBuilder<Message>,
) =>
  h.section(
    [h.Class('category'), h.AriaLabelledBy(`category-${category.id}`)],
    [
      h.div(
        [h.Class('category-heading')],
        [
          h.div(
            [h.Class('category-title-row')],
            [
              h.h2([h.Id(`category-${category.id}`)], [category.title]),
              stabilityBadge(category.stability, h),
            ],
          ),
          h.p([h.Class('muted')], [category.blurb]),
        ],
      ),
      h.ul(
        [h.Class('example-grid')],
        Array.map(category.examples, (example) => exampleCardView(example, h)),
      ),
    ],
  )

const plannedView = (h: HtmlBuilder<Message>) =>
  h.section(
    [h.Class('category'), h.AriaLabelledBy('category-planned')],
    [
      h.div(
        [h.Class('category-heading')],
        [
          h.h2([h.Id('category-planned')], ['Coming next']),
          h.p(
            [h.Class('muted')],
            ['Schema is first. These categories are planned.'],
          ),
        ],
      ),
      h.ul(
        [h.Class('planned-grid')],
        Array.map(plannedCategories, (category) =>
          h.keyed('li')(
            category.id,
            [h.Class('planned-card')],
            [
              h.span([h.Class('example-card-title')], [category.title]),
              h.p([h.Class('example-card-summary')], [category.blurb]),
            ],
          ),
        ),
      ),
    ],
  )

const categoryIndexView = (h: HtmlBuilder<Message>) =>
  h.nav(
    [h.Class('category-index'), h.AriaLabel('Categories')],
    [
      h.ul(
        [],
        Array.map(publishedCategories, (category) =>
          h.keyed('li')(
            category.id,
            [],
            [
              h.a(
                [h.Href(`#category-${category.id}`)],
                [
                  h.span([h.Class('category-index-title')], [category.title]),
                  h.span(
                    [h.Class('category-index-count')],
                    [`${category.examples.length}`],
                  ),
                ],
              ),
            ],
          ),
        ),
      ),
    ],
  )

const homeView = (h: HtmlBuilder<Message>) =>
  h.main(
    [h.Class('home')],
    [
      h.section(
        [h.Class('hero')],
        [
          h.h1([], ['Effect by Example']),
          h.p(
            [h.Class('hero-lede')],
            [
              'Short, annotated programs that show what Effect code does, one idea at a time. Read the notes on the left, the code on the right, then run it in your browser.',
            ],
          ),
          h.p(
            [h.Class('muted')],
            [
              `${exampleCount} examples, each one type-checked and tested against effect ${effectVersion}.`,
            ],
          ),
        ],
      ),
      categoryIndexView(h),
      ...Array.map(publishedCategories, (category) =>
        publishedCategoryView(category, h),
      ),
      Array.isReadonlyArrayEmpty(plannedCategories) ? h.empty : plannedView(h),
    ],
  )

const tokenView = (
  token: { readonly text: string; readonly kind: string },
  h: HtmlBuilder<Message>,
) =>
  token.kind === 'plain'
    ? token.text
    : h.span([h.Class(`token-${token.kind}`)], [token.text])

const codeView = (code: string, h: HtmlBuilder<Message>) =>
  h.pre(
    [h.Class('segment-code')],
    [
      h.code(
        [],
        Array.flatMap(highlight(code, 'typescript'), (line, index) => [
          ...(index === 0 ? [] : ['\n']),
          ...Array.map(line, (token) => tokenView(token, h)),
        ]),
      ),
    ],
  )

const segmentView = (segment: Segment, h: HtmlBuilder<Message>) =>
  h.div(
    [h.Class('segment')],
    [
      h.div([h.Class('segment-prose')], inlineCodeView(segment.prose, h)),
      segment.code === ''
        ? h.div([h.Class('segment-code segment-code-empty')])
        : codeView(segment.code, h),
    ],
  )

const outputLineView = (line: OutputLine, h: HtmlBuilder<Message>) =>
  h.div([h.Class(`output-line output-${line.level}`)], [line.text])

const outputView = (run: RunState, h: HtmlBuilder<Message>) =>
  RunState.match(run, {
    Idle: () =>
      h.p(
        [h.Class('output-hint')],
        [
          'Press Run to execute this program in your browser and see what it prints.',
        ],
      ),
    Running: () => h.p([h.Class('output-hint')], ['Running…']),
    Finished: ({ output }) =>
      h.div(
        [h.Class('output'), h.AriaLabel('Program output'), h.Role('log')],
        [
          ...Array.map(output.lines, (line) => outputLineView(line, h)),
          h.div(
            [h.Class(`output-status output-status-${output.outcome}`)],
            [
              output.outcome === 'succeeded'
                ? 'Program succeeded'
                : 'Program failed',
            ],
          ),
        ],
      ),
  })

const recordedPanelView = (page: ExamplePage, h: HtmlBuilder<Message>) =>
  h.section(
    [h.Class('run-panel'), h.AriaLabel('Recorded output')],
    [
      h.div(
        [h.Class('run-toolbar')],
        [
          h.span(
            [h.Class('run-toolbar-note')],
            [
              'This example needs Node or Bun, so here is what it printed when the tests last ran it.',
            ],
          ),
          h.span([h.Class('run-toolbar-spacer')]),
          Button.view(
            {
              label: 'Copy source',
              onClick: Message.ClickedCopySource(),
              variant: 'outline',
              size: 'sm',
            },
            h,
          ),
        ],
      ),
      Option.match(page.maybeOutput, {
        onNone: () =>
          h.p([h.Class('output-hint')], ['No recorded output yet.']),
        onSome: (output) => outputView(RunState.Finished({ output }), h),
      }),
    ],
  )

const runPanelView = (model: Model, h: HtmlBuilder<Message>) =>
  h.section(
    [
      h.Class('run-panel'),
      h.AriaLabel('Run this example'),
      h.AriaLive('polite'),
    ],
    [
      h.div(
        [h.Class('run-toolbar')],
        [
          Button.view(
            {
              label: model.run._tag === 'Finished' ? 'Run again' : 'Run',
              onClick: Message.ClickedRun(),
              isDisabled: model.run._tag === 'Running',
              size: 'sm',
            },
            h,
          ),
          model.run._tag === 'Finished'
            ? Button.view(
                {
                  label: 'Clear',
                  onClick: Message.ClickedClearOutput(),
                  variant: 'ghost',
                  size: 'sm',
                },
                h,
              )
            : h.empty,
          h.span([h.Class('run-toolbar-spacer')]),
          Button.view(
            {
              label: model.copy._tag === 'Copied' ? 'Copied' : 'Copy source',
              onClick: Message.ClickedCopySource(),
              variant: 'outline',
              size: 'sm',
            },
            h,
          ),
        ],
      ),
      outputView(model.run, h),
    ],
  )

const months = [
  'Jan',
  'Feb',
  'Mar',
  'Apr',
  'May',
  'Jun',
  'Jul',
  'Aug',
  'Sep',
  'Oct',
  'Nov',
  'Dec',
]

const formatDate = (isoDate: string) => {
  const [year = '', month = '1', day = '1'] = isoDate.split('-')
  return `${months[Number(month) - 1] ?? ''} ${Number(day)}, ${year}`
}

const historyView = (
  maybeHistory: Option.Option<ExampleHistory>,
  h: HtmlBuilder<Message>,
) =>
  Option.match(maybeHistory, {
    onNone: () => h.empty,
    onSome: (history) =>
      h.p(
        [h.Class('example-history')],
        [
          `Added ${formatDate(history.added)}`,
          ...(history.updated === history.added
            ? []
            : [` · Updated ${formatDate(history.updated)}`]),
          ` · Checked against effect ${history.effect} on ${formatDate(history.checked)}`,
        ],
      ),
  })

const pagerLinkView = (
  maybeExample: Option.Option<ExampleSummary>,
  direction: 'previous' | 'next',
  h: HtmlBuilder<Message>,
) =>
  Option.match(maybeExample, {
    onNone: () => h.span([]),
    onSome: (example) =>
      h.a(
        [
          h.Class(`pager-link pager-${direction}`),
          h.Href(exampleHref(example)),
        ],
        [
          h.span(
            [h.Class('pager-label')],
            [direction === 'previous' ? '← Previous' : 'Next →'],
          ),
          h.span([h.Class('pager-title')], [example.title]),
        ],
      ),
  })

const pageMessageView = (text: string, h: HtmlBuilder<Message>) =>
  h.section([h.Class('run-panel')], [h.p([h.Class('output-hint')], [text])])

const pageBodyView = (
  model: Model,
  page: ExamplePage,
  h: HtmlBuilder<Message>,
) => {
  const { example } = page
  return [
    example.runtime === 'server'
      ? recordedPanelView(page, h)
      : runPanelView(model, h),
    h.div(
      [h.Class('segments')],
      Array.map(example.segments, (segment) => segmentView(segment, h)),
    ),
    h.details(
      [h.Class('full-source')],
      [
        h.summary([], ['Full source']),
        CodeBlock.view(
          {
            code: example.source,
            language: 'typescript',
            title: `${example.slug}.ts`,
            highlight,
            lineNumbers: true,
            copy: {
              onCopy: Message.ClickedCopySource(),
              isCopied: model.copy._tag === 'Copied',
            },
          },
          h,
        ),
      ],
    ),
  ]
}

const exampleView = (
  model: Model,
  example: ExampleSummary,
  h: HtmlBuilder<Message>,
) => {
  const neighbours = neighboursOf(example)
  const maybePage =
    model.page._tag === 'Loaded' ? Option.some(model.page.page) : Option.none()
  return h.main(
    [h.Class('example')],
    [
      Breadcrumb.view(
        {
          ariaLabel: 'Location',
          items: [
            { label: 'Examples', href: homeRouter() },
            {
              label: Option.match(findCategory(example.category), {
                onNone: () => example.category,
                onSome: (category) => category.title,
              }),
              href: `${homeRouter()}#category-${example.category}`,
            },
          ],
          current: example.title,
        },
        h,
      ),
      h.header(
        [h.Class('example-header')],
        [
          h.div(
            [h.Class('example-title-row')],
            [
              h.h1([], [example.title]),
              difficultyBadge(example, h),
              Option.match(findCategory(example.category), {
                onNone: () => h.empty,
                onSome: (category) => stabilityBadge(category.stability, h),
              }),
            ],
          ),
          h.p([h.Class('example-summary')], inlineCodeView(example.summary, h)),
          historyView(
            Option.flatMap(maybePage, (page) => page.maybeHistory),
            h,
          ),
        ],
      ),
      ...PageState.match(model.page, {
        None: () => [],
        Loading: () => [pageMessageView('Loading…', h)],
        Failed: () => [
          pageMessageView(
            'This example could not be loaded. Reload the page to try again.',
            h,
          ),
        ],
        Loaded: ({ page }) => pageBodyView(model, page, h),
      }),
      h.nav(
        [h.Class('pager'), h.AriaLabel('More examples')],
        [
          pagerLinkView(neighbours.maybePrevious, 'previous', h),
          pagerLinkView(neighbours.maybeNext, 'next', h),
        ],
      ),
    ],
  )
}

const notFoundView = (path: string, h: HtmlBuilder<Message>) =>
  h.main(
    [h.Class('not-found')],
    [
      h.h1([], ['No example here']),
      h.p([h.Class('muted')], [`Nothing lives at ${path}.`]),
      h.a([h.Href(homeRouter())], ['Browse every example']),
    ],
  )

const pageTitle = (route: AppRoute) =>
  AppRoute.match(route, {
    Home: () => 'Effect by Example',
    Example: ({ category, slug }) =>
      Option.match(findExample(category, slug), {
        onNone: () => 'Not found · Effect by Example',
        onSome: (example) => `${example.title} · Effect by Example`,
      }),
    NotFound: () => 'Not found · Effect by Example',
  })

const pageView = (model: Model, h: HtmlBuilder<Message>): Html =>
  AppRoute.match(model.route, {
    Home: () => homeView(h),
    Example: ({ category, slug }) =>
      Option.match(findExample(category, slug), {
        onNone: () => notFoundView(`/${category}/${slug}`, h),
        onSome: (example) => exampleView(model, example, h),
      }),
    NotFound: ({ path }) => notFoundView(path, h),
  })

export const view = (model: Model, h: HtmlBuilder<Message>): Document => ({
  title: pageTitle(model.route),
  body: h.div(
    [h.Class('app'), h.Id('top')],
    [
      headerView(h),
      h.div(
        [h.Class('layout')],
        [
          h.aside(
            [h.Class('layout-sidebar')],
            [
              h.submodel({
                slotId: 'sidebar',
                model: model.sidebar,
                view: Sidebar.view,
                viewInputs: {
                  maybeCurrentKey: currentKey(model.route),
                  shortcutLabel: model.shortcutLabel,
                },
                toParentMessage: (message) =>
                  Message.GotSidebarMessage({ message }),
              }),
            ],
          ),
          pageView(model, h),
        ],
      ),
    ],
  ),
})
