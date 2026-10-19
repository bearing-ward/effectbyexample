import { resolve } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'

import { Client } from '@modelcontextprotocol/sdk/client/index.js'
import { StdioClientTransport } from '@modelcontextprotocol/sdk/client/stdio.js'
import { chromium, expect } from '@playwright/test'
import { Schema } from 'effect'

import { run } from './checks.ts'
import { cloudflare, type HostMode, withHost } from './host.ts'

const RuntimeList = Schema.Struct({
  runtimes: Schema.Array(Schema.Struct({ connectionId: Schema.String })),
})
const ModelResponse = Schema.Struct({
  value: Schema.Struct({
    route: Schema.Struct({ _tag: Schema.String, slug: Schema.String }),
    sidebar: Schema.Struct({ filter: Schema.String }),
  }),
})
const toolJson = (result: Awaited<ReturnType<Client['callTool']>>): unknown => {
  const content = result.content
  if (!Array.isArray(content)) {
    throw new Error('MCP response contains no content')
  }
  const item = content.find(
    (item: unknown) =>
      typeof item === 'object' &&
      item !== null &&
      'type' in item &&
      item.type === 'text',
  )
  if (!item || !('text' in item) || typeof item.text !== 'string') {
    throw new Error('MCP response contains no text')
  }
  if (result.isError || !item.text.startsWith('{')) {
    throw new Error(`MCP response failed: ${item.text}`)
  }
  return JSON.parse(item.text)
}
export async function verifyBrowser(mode: HostMode): Promise<void> {
  if (mode === 'production') {
    console.log((await run(['bun', 'run', 'build'])).stdout)
    if (cloudflare) {
      const result = await Bun.build({
        entrypoints: ['apps/api/src/worker.ts'],
        outdir: '.cache/worker',
        target: 'browser',
        minify: true,
      })
      if (!result.success) {
        throw new Error(
          `Worker production bundle failed: ${result.logs.join('\n')}`,
        )
      }
    }
  }
  await withHost(mode, async ({ url }) => {
    const browser = await chromium.launch()
    try {
      const page = await browser.newPage()
      const errors: Array<string> = []
      page.on('pageerror', (error) => errors.push(error.message))
      await page.goto(url)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Effect by Example' }),
      ).toBeVisible()
      await page
        .getByRole('main')
        .getByRole('link', { name: /Defining a schema/u })
        .click()
      await expect(
        page.getByRole('heading', { level: 1, name: 'Defining a schema' }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Run', exact: true }).click()
      const output = page.getByRole('log', { name: 'Program output' })
      await expect(output).toContainText("{ name: 'Ada', age: 36 }")
      await expect(output).toContainText('Program succeeded')
      await page.getByRole('link', { name: /Next/u }).click()
      await expect(
        page.getByRole('heading', { level: 1, name: /Primitives/u }),
      ).toBeVisible()
      await page.goto(`${url}/schema/tagged-unions`)
      await expect(
        page.getByRole('heading', { level: 1, name: 'Tagged unions' }),
      ).toBeVisible()
      await page.getByRole('button', { name: 'Run', exact: true }).click()
      await expect(
        page.getByRole('log', { name: 'Program output' }),
      ).toContainText('Circle: 3.14')
      for (const [path, expected] of [
        ['/workflow/signals-and-replay', 'emails sent: 1'],
        ['/eventlog/syncing-devices', "'phone: Buy milk'"],
      ] as const) {
        await page.goto(`${url}${path}`)
        await expect(page.getByText('unstable API').first()).toBeVisible()
        await page.getByRole('button', { name: 'Run', exact: true }).click()
        const log = page.getByRole('log', { name: 'Program output' })
        await expect(log).toContainText(expected)
        await expect(log).toContainText('Program succeeded')
      }
      await page.goto(`${url}/platform/files-and-paths`)
      await expect(
        page.getByRole('region', { name: 'Recorded output' }),
      ).toContainText('NotFound: could not read missing.md')
      await expect(
        page.getByRole('button', { name: 'Run', exact: true }),
      ).toHaveCount(0)
      const filter = page.getByRole('searchbox', { name: 'Filter examples' })
      await page.keyboard.press('ControlOrMeta+K')
      await expect(filter).toBeFocused()
      await page.keyboard.type('branded-types')
      await page.keyboard.press('Enter')
      await expect(
        page.getByRole('heading', { level: 1, name: 'Branded types' }),
      ).toBeVisible()
      await expect(page.locator('.example-history')).toContainText(
        'Checked against effect',
      )
      await page.keyboard.press('ControlOrMeta+K')
      await page.keyboard.press('Escape')
      // The first category starts collapsed on another category's page.
      await page.keyboard.press('ArrowDown')
      const firstToggle = page.locator('.sidebar-toggle').first()
      await expect(firstToggle).toBeFocused()
      await expect(firstToggle).toHaveAttribute('aria-expanded', 'false')
      await page.keyboard.press('ArrowRight')
      await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
      await page.keyboard.press('ArrowRight')
      const firstLink = page
        .locator('.sidebar-category')
        .first()
        .locator('a')
        .first()
      await expect(firstLink).toBeFocused()
      await page.keyboard.press('ArrowLeft')
      await expect(firstToggle).toBeFocused()
      await page.keyboard.press('ArrowLeft')
      await expect(firstToggle).toHaveAttribute('aria-expanded', 'false')
      await expect(firstLink).toHaveCount(0)
      await page.keyboard.press('Enter')
      await expect(firstToggle).toHaveAttribute('aria-expanded', 'true')
      if (cloudflare) {
        const response: unknown = await page.evaluate(async () =>
          (await fetch('/api/health')).json(),
        )
        expect(response).toMatchObject({ status: 'ok' })
        expect((await page.request.get(`${url}/api/missing`)).status()).toBe(
          404,
        )
      }
      if (mode === 'development') {
        await expect(page.locator('.dt-badge')).toBeVisible()
        await page.locator('.dt-badge').click()
        await expect(page.locator('.dt-panel')).toBeVisible()
        const transport = new StdioClientTransport({
          command: process.execPath,
          args: ['run', 'foldkit:mcp'],
          cwd: resolve(import.meta.dirname, '..'),
          env: {
            ...Object.fromEntries(
              Object.entries(process.env).filter(
                (entry): entry is [string, string] => entry[1] !== undefined,
              ),
            ),
            FOLDKIT_PROJECT_ROOT: resolve(import.meta.dirname, '../apps/web'),
          },
          stderr: 'pipe',
        })
        const client = new Client({
          name: 'effectbyexample-verification',
          version: '1.0.0',
        })
        let mcpLogs = ''
        transport.stderr?.on('data', (chunk: Buffer) => {
          mcpLogs = (mcpLogs + chunk.toString()).slice(-16_384)
        })
        try {
          await client.connect(transport)
          const response = await (async () => {
            const end = Date.now() + 15_000
            let last: unknown
            while (Date.now() < end) {
              try {
                const value = Schema.decodeUnknownSync(RuntimeList)(
                  toolJson(
                    await client.callTool(
                      { name: 'foldkit_list_runtimes', arguments: {} },
                      undefined,
                      { timeout: 3000 },
                    ),
                  ),
                )
                const runtime = value.runtimes[0]
                if (runtime) {
                  return Schema.decodeUnknownSync(ModelResponse)(
                    toolJson(
                      await client.callTool(
                        {
                          name: 'foldkit_get_model',
                          arguments: {
                            runtime_id: runtime.connectionId,
                            expand: true,
                          },
                        },
                        undefined,
                        { timeout: 3000 },
                      ),
                    ),
                  )
                }
              } catch (error) {
                last = error
              }
              await pause(150)
            }
            throw new Error(
              `No browser-connected MCP Model before deadline\n${mcpLogs}`,
              { cause: last },
            )
          })()
          expect(response.value.route.slug).toBe('branded-types')
          expect(response.value.sidebar.filter).toBe('')
          console.log('PASS browser DevTools overlay and MCP live Model')
        } finally {
          await client.close()
          await transport.close()
        }
      } else {
        await expect(page.locator('.dt-badge')).toHaveCount(0)
        const sourceRoute = await page.request.get(`${url}/src/entry.ts`)
        expect(await sourceRoute.text()).not.toContain(
          'Runtime.makeApplication',
        )
        console.log(
          'PASS production artifact example run; DevTools absent and source entry not served',
        )
      }
      expect(errors).toEqual([])
      console.log(
        `PASS ${mode} browser example run, navigation, and deep link${cloudflare ? ' with same-origin Worker health/404' : ''}`,
      )
    } finally {
      await browser.close()
    }
  })
}
