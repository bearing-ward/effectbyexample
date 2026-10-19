import { readdir, readFile, writeFile } from 'node:fs/promises'
import { join, resolve } from 'node:path'
import { parseArgs } from 'node:util'

import { Option, Schema } from 'effect'

import {
  categories,
  exemptExports,
  exemptModules,
  exhaustiveSubpaths,
} from '../packages/examples/src/catalog.ts'
import {
  ContentLog,
  contentStatus,
  describeAttention,
  pendingChanges,
  recordChanges,
  recordReviews,
  type SourceFingerprint,
} from '../packages/examples/src/content-log.ts'
import {
  coverage,
  declaredValues,
  exportCoverage,
} from '../packages/examples/src/coverage.ts'
import { exampleFile } from '../packages/examples/src/parse.ts'
import effectManifest from '../node_modules/effect/package.json' with { type: 'json' }

const usage = `Usage: bun run scripts/content.ts <command>

  status [--stale-days 180] [--offline]  what changed, when, and what needs attention
  log [--note "..."]                      record added, modified, and removed examples
  review <category/slug>... | --all [--note "..."]
                                          record that examples were reread and still hold
  check                                   fail when sources changed without a log entry`

const root = resolve(import.meta.dirname, '..')
const examplesSource = join(root, 'packages/examples/src')
const logPath = join(root, 'packages/examples/content-log.json')
const installedEffect = effectManifest.version

const today = () => {
  const now = new Date()
  const pad = (value: number) => String(value).padStart(2, '0')
  return `${now.getFullYear()}-${pad(now.getMonth() + 1)}-${pad(now.getDate())}`
}

type ExampleSource = SourceFingerprint & { readonly source: string }

const exampleSources = async (): Promise<ReadonlyArray<ExampleSource>> => {
  const directories = (
    await readdir(examplesSource, { withFileTypes: true })
  ).filter((entry) => entry.isDirectory() && !entry.name.startsWith('__'))
  const nested = await Promise.all(
    directories.map(async (directory) => {
      const files = await readdir(join(examplesSource, directory.name))
      return Promise.all(
        files.flatMap((file) =>
          Option.match(exampleFile(file), {
            onNone: () => [],
            onSome: ({ slug }) => [
              readFile(join(examplesSource, directory.name, file), 'utf8').then(
                (source) => ({
                  key: `${directory.name}/${slug}`,
                  hash: new Bun.CryptoHasher('sha256')
                    .update(source)
                    .digest('hex'),
                  source,
                }),
              ),
            ],
          }),
        ),
      )
    }),
  )
  return nested.flat().sort((a, b) => a.key.localeCompare(b.key))
}

const fingerprints = async (): Promise<ReadonlyArray<SourceFingerprint>> =>
  (await exampleSources()).map(({ key, hash }) => ({ key, hash }))

const effectDist = join(root, 'node_modules/effect/dist')

const moduleNames = async (indexPath: string) =>
  [
    ...(await readFile(indexPath, 'utf8')).matchAll(
      /^export \* as ([A-Za-z0-9]+) from/gmu,
    ),
  ].map((match) => match[1] ?? '')

/** Every module `effect` exports, as `Effect` or `http/HttpClient`. */
const exportedModules = async () => {
  const subpaths = Object.keys(effectManifest.exports)
    .map((key) => key.replace(/^\.\/?/u, ''))
    .filter(
      (key) =>
        key !== '' &&
        key !== 'index' &&
        key !== 'package.json' &&
        !key.includes('*'),
    )
  const rootModules = await moduleNames(join(effectDist, 'index.d.ts'))
  const nested = await Promise.all(
    subpaths.map(async (subpath) =>
      (await moduleNames(join(effectDist, subpath, 'index.d.ts'))).map(
        (name) => `${subpath}/${name}`,
      ),
    ),
  )
  return [...rootModules, ...nested.flat()]
}

/** Value exports of every module under the exhaustive subpaths. */
const exhaustiveExports = async () =>
  Promise.all(
    exhaustiveSubpaths.flatMap(async (subpath) =>
      Promise.all(
        (await moduleNames(join(effectDist, subpath, 'index.d.ts'))).map(
          async (name) => ({
            module: `${subpath}/${name}`,
            exports: declaredValues(
              await readFile(join(effectDist, subpath, `${name}.d.ts`), 'utf8'),
            ),
          }),
        ),
      ),
    ),
  ).then((groups) => groups.flat())

const exportReport = async () =>
  exportCoverage(
    await exhaustiveExports(),
    exemptExports,
    (await exampleSources()).map((example) => example.source),
  )

const describeExportGaps = (report: Awaited<ReturnType<typeof exportReport>>) =>
  report.uncovered.map(
    (group) => `  - ${group.module}: ${group.exports.join(', ')}`,
  )

const readLog = async () =>
  Schema.decodeUnknownSync(ContentLog)(
    JSON.parse(await readFile(logPath, 'utf8').catch(() => '{"entries":[]}')),
  )

const writeLog = (log: ContentLog) =>
  writeFile(logPath, `${JSON.stringify(log, null, 2)}\n`)

const latestEffect = async () => {
  try {
    const response = await fetch('https://registry.npmjs.org/effect/latest', {
      signal: AbortSignal.timeout(4000),
    })
    const body: unknown = await response.json()
    return typeof body === 'object' &&
      body !== null &&
      'version' in body &&
      typeof body.version === 'string'
      ? Option.some(body.version)
      : Option.none()
  } catch {
    return Option.none()
  }
}

const { positionals, values } = parseArgs({
  args: process.argv.slice(2),
  allowPositionals: true,
  options: {
    note: { type: 'string' },
    all: { type: 'boolean', default: false },
    offline: { type: 'boolean', default: false },
    'stale-days': { type: 'string', default: '180' },
  },
})
const [command, ...keys] = positionals
const context = {
  date: today(),
  effect: installedEffect,
  ...(values.note === undefined ? {} : { note: values.note }),
}

if (command === 'log') {
  const log = await readLog()
  const changes = pendingChanges(log, await fingerprints())
  if (changes.length === 0) {
    console.log('Content log is up to date.')
  } else {
    await writeLog(recordChanges(log, changes, context))
    for (const change of changes) {
      console.log(`${context.date}  ${change.kind.padEnd(8)}  ${change.key}`)
    }
  }
} else if (command === 'review') {
  const log = await readLog()
  const sources = await fingerprints()
  if (pendingChanges(log, sources).length > 0) {
    console.error('Record source changes first with `bun run content:log`.')
    process.exit(1)
  }
  const targets = values.all ? sources.map((source) => source.key) : keys
  const unknown = targets.filter(
    (key) => !sources.some((source) => source.key === key),
  )
  if (targets.length === 0 || unknown.length > 0) {
    console.error(
      unknown.length > 0 ? `Unknown examples: ${unknown.join(', ')}` : usage,
    )
    process.exit(1)
  }
  await writeLog(recordReviews(log, targets, context))
  console.log(
    `Reviewed ${targets.length} example(s) against effect ${installedEffect}.`,
  )
} else if (command === 'check') {
  const changes = pendingChanges(await readLog(), await fingerprints())
  if (changes.length > 0) {
    console.error(
      `Content log is missing ${changes.length} change(s); run \`bun run content:log\`:\n${changes
        .map((change) => `  ${change.kind} ${change.key}`)
        .join('\n')}`,
    )
    process.exit(1)
  }
  console.log('PASS content log matches example sources')
  const exports = await exportReport()
  if (exports.uncovered.length > 0) {
    console.error(
      `Export coverage for ${exhaustiveSubpaths.join(', ')}: ${exports.coveredCount} of ${exports.exportedCount}; no example reads:\n${describeExportGaps(exports).join('\n')}`,
    )
    process.exit(1)
  }
  console.log(
    `PASS every ${exhaustiveSubpaths.join(', ')} export is read by an example (${exports.exportedCount})`,
  )
} else if (command === 'status') {
  const status = contentStatus(
    await readLog(),
    await fingerprints(),
    categories,
    {
      today: today(),
      installedEffect,
      maybeLatestEffect: values.offline ? Option.none() : await latestEffect(),
      staleAfterDays: Number(values['stale-days']),
    },
  )
  const header = ['example', 'added', 'updated', 'checked', 'effect']
  const rows = status.histories.map((history) => [
    history.key,
    history.added,
    history.updated,
    history.checked,
    history.effect,
  ])
  const widths = header.map((title, index) =>
    Math.max(title.length, ...rows.map((row) => row[index]?.length ?? 0)),
  )
  const line = (cells: ReadonlyArray<string>) =>
    cells.map((cell, index) => cell.padEnd(widths[index] ?? 0)).join('  ')
  console.log(line(header))
  for (const row of rows) {
    console.log(line(row))
  }
  const report = coverage(
    await exportedModules(),
    exemptModules.map((exemption) => exemption.module),
    categories,
    (await exampleSources()).map((example) => example.source),
  )
  console.log('')
  console.log(
    `Module coverage: ${report.coveredCount} of ${report.exportedCount} exported modules are demonstrated by an example.`,
  )
  for (const group of report.uncovered) {
    console.log(`  - ${group.category}: ${group.modules.join(', ')}`)
  }
  if (report.unassigned.length > 0) {
    console.log(
      `  - not assigned to any category: ${report.unassigned.join(', ')}`,
    )
  }
  const exports = await exportReport()
  console.log(
    `Export coverage (${exhaustiveSubpaths.join(', ')}): ${exports.coveredCount} of ${exports.exportedCount} exported values are read by an example.`,
  )
  for (const line of describeExportGaps(exports)) {
    console.log(line)
  }
  console.log('')
  if (status.attention.length === 0) {
    console.log('Nothing needs attention.')
  } else {
    console.log(`Needs attention (${status.attention.length}):`)
    for (const item of status.attention) {
      console.log(`  - ${describeAttention(item)}`)
    }
  }
} else {
  console.error(usage)
  process.exit(command === undefined ? 0 : 1)
}
