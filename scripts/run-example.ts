import { readdir } from 'node:fs/promises'
import { join, resolve } from 'node:path'

import { Effect, Option } from 'effect'

import { exampleFile, parseExample } from '../packages/examples/src/parse.ts'
import { type Program, runProgram } from '../packages/examples/src/run.ts'

// Runs examples by key and prints their output and prose segments, for
// authoring. Usage: bun run examples:run <category/slug>... [--segments]
const examples = resolve(import.meta.dirname, '../packages/examples/src')
const showSegments = process.argv.includes('--segments')
const keys = process.argv.slice(2).filter((arg) => !arg.startsWith('--'))

for (const key of keys) {
  const [category = '', slug = ''] = key.split('/')
  const files = await readdir(join(examples, category))
  const file = files.find((name) =>
    Option.exists(exampleFile(name), (parsed) => parsed.slug === slug),
  )
  if (file === undefined) {
    console.log(`\n===== ${key}: no such example`)
    process.exitCode = 1
    continue
  }
  const path = join(examples, category, file)
  const example = parseExample(category, slug, await Bun.file(path).text())
  const module: { readonly program?: Program } = await import(path)
  if (!module.program) {
    console.log(`\n===== ${key}: no exported program`)
    process.exitCode = 1
    continue
  }
  const output = await Effect.runPromise(
    runProgram(module.program).pipe(
      Effect.timeout('20 seconds'),
      Effect.catch((error) =>
        Effect.succeed({
          outcome: 'failed' as const,
          lines: [{ level: 'error' as const, text: String(error) }],
        }),
      ),
    ),
  )
  console.log(`\n===== ${key} [${output.outcome}] ${example.title}`)
  for (const line of output.lines) {
    console.log(
      line.level === 'log' ? line.text : `(${line.level}) ${line.text}`,
    )
  }
  if (output.outcome !== 'succeeded') {
    process.exitCode = 1
  }
  if (showSegments) {
    for (const segment of example.segments) {
      console.log(`\n  PROSE: ${segment.prose}\n  CODE:\n${segment.code}`)
    }
  }
}
