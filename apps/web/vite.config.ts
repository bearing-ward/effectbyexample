import { mkdir, readFile, writeFile } from 'node:fs/promises'
import { dirname, join } from 'node:path'

import { foldkit } from '@foldkit/vite-plugin'
import { foldworksLayers, foldworksStylexTest } from '@foldworks/ui/vite'
import stylexVite from '@stylexjs/unplugin/vite'
import { defineConfig, type Plugin } from 'vite'

import { categories, exampleKey } from '../../packages/examples/src/catalog.ts'
import { projectName } from '../../scripts/project.ts'
import { examplesPlugin } from './examples-plugin.ts'

const productionBoundary: Plugin = {
  name: 'production-boundary',
  generateBundle(_options, bundle) {
    if (
      Object.values(bundle).some(
        (item) =>
          item.type === 'chunk' &&
          Object.keys(item.modules).some((id) =>
            /(?:@foldkit\/devtools|foldkit\/.*devtools|devtoolsMcp)/u.test(id),
          ),
      )
    ) {
      throw new Error('DevTools or MCP leaked into production.')
    }
  },
}

// GitHub Pages serves static files only, below `/<repository>/`. Building
// with `PAGES_BASE` set (see `bun run build:pages`) sets that base and writes
// a copy of index.html for every example, so deep links load with status 200,
// plus 404.html so any other path still boots the app and shows Not found.
const pagesBase = process.env.PAGES_BASE

const pagesFallbacks: Plugin = {
  name: 'pages-fallbacks',
  apply: 'build',
  async writeBundle({ dir }) {
    if (dir === undefined) {
      throw new Error('The build has no output directory.')
    }
    const index = await readFile(join(dir, 'index.html'))
    const pages = [
      '404.html',
      ...categories.flatMap((category) =>
        category.slugs.map((slug) => `${exampleKey(category.id, slug)}.html`),
      ),
    ]
    for (const page of pages) {
      await mkdir(dirname(join(dir, page)), { recursive: true })
      await writeFile(join(dir, page), index)
    }
    await writeFile(join(dir, '.nojekyll'), '')
  },
}

export default defineConfig(({ mode }) => ({
  plugins:
    mode === 'test'
      ? [foldworksStylexTest(), examplesPlugin()]
      : [
          stylexVite({
            dev: mode === 'development',
            runtimeInjection: false,
            // NOTE: `alchemy dev` runs Vite from apps/deploy, so resolve StyleX
            // constants (the Foldworks tokens) from this app, not the cwd.
            unstable_moduleResolution: {
              type: 'commonJS',
              rootDir: import.meta.dirname,
            },
            useCSSLayers: { before: foldworksLayers },
          }),
          examplesPlugin(),
          foldkit(),
          productionBoundary,
          ...(pagesBase === undefined ? [] : [pagesFallbacks]),
        ],
  base: pagesBase ?? '/',
  optimizeDeps: {
    exclude: [
      '@foldkit/ui',
      '@foldworks/ui',
      '@foldworks/code-editor',
      'effect',
      'foldkit',
    ],
  },
  resolve: { dedupe: ['effect', 'foldkit'] },
  server: {
    host: '127.0.0.1',
    allowedHosts: [`${projectName}.localhost`, '.localhost'],
  },
}))
