import {
  type Category,
  categories,
  ExamplePage,
  ExampleSummary,
  exampleFile,
  exampleKey,
  type Program,
} from '@ebe/examples'
import { Array, Effect, Option, pipe, Schema } from 'effect'
import { pageLoaders, summaries } from 'virtual:examples'

// NOTE: The app ships only each example's header. A page's prose, code,
// history, and recorded output load when it opens; see `examples-plugin.ts`.
const allSummaries = Schema.decodeUnknownSync(Schema.Array(ExampleSummary))(
  summaries,
)

/** Loads everything an example's page shows beyond its summary. */
export const loadPage = (key: string) =>
  pipe(
    Option.fromNullishOr(pageLoaders[key]),
    Option.map((load) =>
      Effect.tryPromise(load).pipe(
        Effect.flatMap((module) =>
          Schema.decodeUnknownEffect(ExamplePage)(module.default),
        ),
      ),
    ),
  )

// NOTE: Programs load on demand, one chunk per example. Server examples are
// left out because they import Node-only modules the browser cannot bundle.
const programLoaders = import.meta.glob<Program>(
  [
    '../../../packages/examples/src/*/*.ts',
    '!../../../packages/examples/src/*/*.test.ts',
    '!../../../packages/examples/src/*/*.server.ts',
  ],
  { import: 'program', eager: false },
)

const pathParts = (path: string) => {
  const [fileName = '', category = ''] = path.split('/').reverse()
  return { category, fileName }
}

/** Loads the runnable program of a browser example. */
export const loadProgram = (key: string) =>
  pipe(
    Object.entries(programLoaders),
    Array.findFirst(([path]) => {
      const parts = pathParts(path)
      return Option.exists(
        exampleFile(parts.fileName),
        (file) => exampleKey(parts.category, file.slug) === key,
      )
    }),
    Option.map(([, load]) => load),
  )

export type PublishedCategory = Category & {
  readonly examples: ReadonlyArray<ExampleSummary>
}

export const publishedCategories: ReadonlyArray<PublishedCategory> = pipe(
  categories,
  Array.filter((category) => category.status === 'published'),
  Array.map((category) => ({
    ...category,
    examples: Array.filter(
      allSummaries,
      (summary) => summary.category === category.id,
    ),
  })),
)

export const plannedCategories: ReadonlyArray<Category> = Array.filter(
  categories,
  (category) => category.status === 'planned',
)

const allExamples = Array.flatMap(
  publishedCategories,
  (category) => category.examples,
)

export const exampleCount = allExamples.length

export const findExample = (category: string, slug: string) =>
  Array.findFirst(
    allExamples,
    (example) => example.category === category && example.slug === slug,
  )

export const findCategory = (id: string) =>
  Array.findFirst(publishedCategories, (category) => category.id === id)

export type Neighbours = {
  readonly maybePrevious: Option.Option<ExampleSummary>
  readonly maybeNext: Option.Option<ExampleSummary>
}

export const neighboursOf = (example: ExampleSummary): Neighbours =>
  pipe(
    Array.findFirstIndex(
      allExamples,
      (candidate) =>
        candidate.category === example.category &&
        candidate.slug === example.slug,
    ),
    Option.match({
      onNone: () => ({
        maybePrevious: Option.none(),
        maybeNext: Option.none(),
      }),
      onSome: (index) => ({
        maybePrevious: Array.get(allExamples, index - 1),
        maybeNext: Array.get(allExamples, index + 1),
      }),
    }),
  )
