import { resolve } from 'node:path'

import { Miniflare } from 'miniflare'

import { projectName } from './project.ts'

const runtime = new Miniflare({
  name: projectName,
  host: '127.0.0.1',
  port: Number(process.env.PORT ?? 4173),
  modules: true,
  scriptPath: resolve(import.meta.dirname, '../.cache/worker/worker.js'),
  compatibilityDate: '2026-07-30',
  assets: {
    directory: resolve(import.meta.dirname, '../apps/web/dist'),
    binding: 'ASSETS',
    routerConfig: {
      has_user_worker: true,
      static_routing: { user_worker: ['/api/*'] },
    },
    assetConfig: { not_found_handling: 'single-page-application' },
  },
})
console.log(
  `${projectName} production Worker artifact at ${await runtime.ready}`,
)
process.on('SIGTERM', () => {
  void runtime.dispose().then(() => process.exit(0))
})
