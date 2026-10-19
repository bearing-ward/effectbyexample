import { join, resolve } from 'node:path'

import { chromium, expect } from '@playwright/test'

import { run } from './checks.ts'

const root = resolve(import.meta.dirname, '..')
const dist = join(root, 'apps/web/dist')
const base = '/effectbyexample'

// Serves the build the way GitHub Pages does: below the repository path,
// `/x` from `x`, `x.html` or `x/index.html`, and 404.html with status 404
// for anything else.
const servePages = () =>
  Bun.serve({
    hostname: '127.0.0.1',
    port: 0,
    async fetch(request) {
      const { pathname } = new URL(request.url)
      if (pathname !== base && !pathname.startsWith(`${base}/`)) {
        return new Response('Not found', { status: 404 })
      }
      const path = decodeURIComponent(pathname.slice(base.length))
      for (const candidate of [path, `${path}.html`, `${path}/index.html`]) {
        const file = Bun.file(join(dist, candidate))
        if (!candidate.endsWith('/') && (await file.exists())) {
          return new Response(file)
        }
      }
      return new Response(Bun.file(join(dist, '404.html')), { status: 404 })
    },
  })

export async function verifyPages(): Promise<void> {
  // `build:pages` defaults `PAGES_BASE` to `${base}/`.
  console.log((await run(['bun', 'run', 'build:pages'])).stdout)
  const server = servePages()
  const url = `http://127.0.0.1:${server.port}${base}`
  const browser = await chromium.launch()
  try {
    const page = await browser.newPage()
    const errors: Array<string> = []
    page.on('pageerror', (error) => errors.push(error.message))

    const deepLink = await page.goto(`${url}/schema/tagged-unions`)
    expect(deepLink?.status()).toBe(200)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Tagged unions' }),
    ).toBeVisible()
    await page.getByRole('button', { name: 'Run', exact: true }).click()
    await expect(
      page.getByRole('log', { name: 'Program output' }),
    ).toContainText('Circle: 3.14')

    await page.getByRole('link', { name: /Next/u }).click()
    await expect(page).toHaveURL(new RegExp(`${base}/schema/[a-z-]+$`, 'u'))
    await page.getByRole('link', { name: 'Effect by Example' }).first().click()
    await expect(page).toHaveURL(`${url}/`)
    await expect(
      page.getByRole('heading', { level: 1, name: 'Effect by Example' }),
    ).toBeVisible()

    await page.goto(`${url}/platform/files-and-paths`)
    await expect(
      page.getByRole('region', { name: 'Recorded output' }),
    ).toContainText('NotFound: could not read missing.md')

    const missing = await page.goto(`${url}/no/such-page`)
    expect(missing?.status()).toBe(404)
    await expect(page).toHaveTitle('Not found · Effect by Example')

    expect(errors).toEqual([])
    console.log(
      `PASS GitHub Pages build below ${base}/: deep link, run, navigation, and 404`,
    )
  } finally {
    await browser.close()
    await server.stop(true)
  }
}

if (import.meta.main) {
  await verifyPages()
}
