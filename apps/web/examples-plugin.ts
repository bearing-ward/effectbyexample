import { readdir, readFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { Option, Schema } from 'effect'
import type { Plugin, ViteDevServer } from 'vite'

import {
  categories,
  ContentLog,
  type ExamplePage,
  ExamplePage as ExamplePageSchema,
  type ExampleSummary,
  exampleFile,
  exampleKey,
  historyOf,
  Output,
  parseExample,
} from '../../packages/examples/src/index.ts'

const examplesRoot = resolve(import.meta.dirname, '../../packages/examples')
const sourceRoot = join(examplesRoot, 'src')
const contentLogPath = join(examplesRoot, 'content-log.json')
const outputsPath = join(examplesRoot, 'outputs.json')

// `virtual:examples` lists every published example's header, small enough to
// ship with the app. Each `virtual:example-page/<category>/<slug>` holds the
// rest of one page (prose, code, history, recorded output) as its own chunk,
// which the app loads when that page opens.
const indexId = 'virtual:examples'
const pagePrefix = 'virtual:example-page/'
const resolved = (id: string) => `\0${id}`

const readJson = async (path: string): Promise<unknown> =>
  JSON.parse(await readFile(path, 'utf8'))

const sourceFiles = async (category: string) =>
  (await readdir(join(sourceRoot, category)).catch(() => [])).flatMap((file) =>
    Option.match(exampleFile(file), {
      onNone: () => [],
      onSome: ({ slug, runtime }) => [{ file, slug, runtime }],
    }),
  )

const readExample = async (category: string, slug: string) => {
  const match = (await sourceFiles(category)).find((file) => file.slug === slug)
  if (match === undefined) {
    throw new Error(`No source file for ${exampleKey(category, slug)}`)
  }
  const path = join(sourceRoot, category, match.file)
  return {
    path,
    example: parseExample(
      category,
      slug,
      await readFile(path, 'utf8'),
      match.runtime,
    ),
  }
}

const summaryOf = ({
  category,
  slug,
  title,
  difficulty,
  runtime,
  summary,
}: ExampleSummary): ExampleSummary => ({
  category,
  slug,
  title,
  difficulty,
  runtime,
  summary,
})

const published = categories.filter(
  (category) => category.status === 'published',
)

export const examplesPlugin = (): Plugin => ({
  name: 'examples',
  resolveId(id) {
    return id === indexId || id.startsWith(pagePrefix) ? resolved(id) : null
  },
  async load(id) {
    if (id === resolved(indexId)) {
      const summaries: Array<ExampleSummary> = []
      for (const category of published) {
        for (const slug of category.slugs) {
          const { path, example } = await readExample(category.id, slug)
          this.addWatchFile(path)
          summaries.push(summaryOf(example))
        }
      }
      const loaders = summaries.map((summary) => {
        const key = exampleKey(summary.category, summary.slug)
        return `  ${JSON.stringify(key)}: () => import(${JSON.stringify(`${pagePrefix}${key}`)}),`
      })
      return [
        `export const summaries = ${JSON.stringify(summaries)}`,
        `export const pageLoaders = {\n${loaders.join('\n')}\n}`,
      ].join('\n')
    }
    if (id.startsWith(resolved(pagePrefix))) {
      const key = id.slice(resolved(pagePrefix).length)
      const [category = '', slug = ''] = key.split('/')
      const { path, example } = await readExample(category, slug)
      this.addWatchFile(path)
      this.addWatchFile(contentLogPath)
      this.addWatchFile(outputsPath)
      const log = Schema.decodeUnknownSync(ContentLog)(
        await readJson(contentLogPath),
      )
      const outputs = Schema.decodeUnknownSync(
        Schema.Record(Schema.String, Output),
      )(await readJson(outputsPath))
      const page: ExamplePage = {
        example,
        maybeHistory: historyOf(log, key),
        maybeOutput: Option.fromNullishOr(outputs[key]),
      }
      return `export default ${JSON.stringify(Schema.encodeSync(ExamplePageSchema)(page))}`
    }
    return null
  },
  // A changed example, log, or recording can change any page and the index,
  // so drop every virtual module and reload.
  handleHotUpdate({ file, server }) {
    if (file.startsWith(examplesRoot) && !file.endsWith('.test.ts')) {
      invalidateAll(server)
      server.ws.send({ type: 'full-reload' })
      return []
    }
    return undefined
  },
})

const invalidateAll = (server: ViteDevServer) => {
  for (const module of server.moduleGraph.idToModuleMap.values()) {
    if (module.id?.startsWith('\0virtual:example')) {
      server.moduleGraph.invalidateModule(module)
    }
  }
}
