import { existsSync, readdirSync, readFileSync, writeFileSync } from 'node:fs'
import { join } from 'node:path'

import { Effect, Option } from 'effect'
import { afterAll, describe, expect, test } from 'vitest'

import { categories, exampleKey } from './catalog.ts'
import type { Output } from './example.ts'
import { exampleFile, parseExample } from './parse.ts'
import { type Program, runProgram } from './run.ts'
import { effectVersion } from './version.ts'

// Recorded output for every example lives in outputs.json. The site shows it
// for server-only examples. Regenerate it with `bun run examples:outputs`.
const outputsPath = join(import.meta.dirname, '../outputs.json')
const isUpdating = process.env.UPDATE_OUTPUTS === '1'
const recorded: Readonly<Record<string, Output>> = existsSync(outputsPath)
  ? JSON.parse(readFileSync(outputsPath, 'utf8'))
  : {}
const observed: Record<string, Output> = {}

const programTimeout = '20 seconds'

test('the documented Effect version is the one installed', () => {
  const installed: unknown = JSON.parse(
    readFileSync(
      join(import.meta.dirname, '../../../node_modules/effect/package.json'),
      'utf8',
    ),
  )
  expect(installed).toMatchObject({ version: effectVersion })
})

test('every example directory belongs to a category', () => {
  const directories = readdirSync(import.meta.dirname, { withFileTypes: true })
    .filter((entry) => entry.isDirectory() && !entry.name.startsWith('__'))
    .map((entry) => entry.name)
  const ids = categories.map((category) => category.id)
  expect(directories.filter((directory) => !ids.includes(directory))).toEqual(
    [],
  )
})

const withFiles = categories.filter((category) =>
  existsSync(join(import.meta.dirname, category.id)),
)

describe.each(withFiles)('$title examples', (category) => {
  const directory = join(import.meta.dirname, category.id)
  const files = readdirSync(directory).flatMap((file) =>
    Option.match(exampleFile(file), {
      onNone: () => [],
      onSome: (parsed) => [{ file, ...parsed }],
    }),
  )

  test('every file is listed in the catalog, and only those', () => {
    expect([...category.slugs].sort()).toEqual(
      files.map((file) => file.slug).sort(),
    )
  })

  test.each(files)(
    '$slug parses, runs, and prints its recorded output',
    async ({ file, slug, runtime }) => {
      const key = exampleKey(category.id, slug)
      const source = readFileSync(join(directory, file), 'utf8')
      const example = parseExample(category.id, slug, source, runtime)
      expect(example.segments.length).toBeGreaterThan(1)
      const module: { readonly program?: Program } = await import(
        join(directory, file)
      )
      expect(module.program).toBeDefined()
      if (!module.program) {
        return
      }
      const output = await Effect.runPromise(
        runProgram(module.program).pipe(Effect.timeout(programTimeout)),
      )
      observed[key] = output
      expect(output.outcome).toBe('succeeded')
      if (!isUpdating) {
        expect(output).toEqual(recorded[key])
      }
    },
    30_000,
  )
})

afterAll(() => {
  if (isUpdating) {
    const sorted = Object.fromEntries(
      Object.entries(observed).sort(([a], [b]) => a.localeCompare(b)),
    )
    writeFileSync(outputsPath, `${JSON.stringify(sorted, null, 2)}\n`)
  }
})
