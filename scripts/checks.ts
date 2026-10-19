import { existsSync } from 'node:fs'
import { cp, mkdtemp, rm, symlink } from 'node:fs/promises'
import { tmpdir } from 'node:os'
import { dirname, resolve, relative, isAbsolute } from 'node:path'

import getExePath from '@effect/tsgo/lib/getExePath'
import { Schema } from 'effect'
import { API } from 'typescript/unstable/async'

const Project = Schema.Struct({
  config: Schema.String,
  environment: Schema.Literals(['neutral', 'browser', 'server', 'tool']),
})
const Manifest = Schema.Struct({
  name: Schema.String,
  hvs: Schema.Struct({
    checks: Schema.Struct({
      projects: Schema.Array(Project).check(Schema.isMinLength(1)),
    }),
  }),
})
const Root = Schema.Struct({ workspaces: Schema.Array(Schema.String) })
export type CompilerProject = {
  readonly config: string
  readonly environment: typeof Project.Type.environment
  readonly workspace: string
}
const root = resolve(import.meta.dirname, '..')
export const run = async (
  command: ReadonlyArray<string>,
  allowFailure = false,
  directory = root,
): Promise<{ code: number; stdout: string; stderr: string }> => {
  const child = Bun.spawn([...command], {
    cwd: directory,
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, NO_COLOR: '1' },
  })
  const timer = setTimeout(() => child.kill('SIGKILL'), 180_000)
  try {
    const [stdout, stderr, code] = await Promise.all([
      new Response(child.stdout).text(),
      new Response(child.stderr).text(),
      child.exited,
    ])
    if (code !== 0 && !allowFailure) {
      throw new Error(
        `${command.join(' ')} exited ${code}\n${stdout}\n${stderr}`,
      )
    }
    return { code, stdout, stderr }
  } finally {
    clearTimeout(timer)
    child.kill()
  }
}
export async function compilerProjects(
  directory = root,
): Promise<Array<CompilerProject>> {
  const manifest = Schema.decodeUnknownSync(Root)(
    await Bun.file(resolve(directory, 'package.json')).json(),
  )
  const paths = new Set<string>(['package.json'])
  for (const pattern of manifest.workspaces) {
    if (isAbsolute(pattern) || pattern.split('/').includes('..')) {
      throw new Error(`Workspace pattern escapes project: ${pattern}`)
    }
    const matches = await Array.fromAsync(
      new Bun.Glob(`${pattern}/package.json`).scan({
        cwd: directory,
        onlyFiles: true,
      }),
    )
    if (matches.length === 0) {
      throw new Error(`Workspace pattern matched no manifests: ${pattern}`)
    }
    matches.forEach((path) => paths.add(path))
  }
  const programs = await Promise.all(
    [...paths].sort().map(async (path) => {
      const checked = Schema.decodeUnknownSync(Manifest)(
        await Bun.file(resolve(directory, path)).json(),
      )
      const workspace = resolve(directory, path, '..')
      return checked.hvs.checks.projects.map((project) => {
        const config = resolve(workspace, project.config)
        const local = relative(workspace, config)
        if (isAbsolute(project.config) || local.startsWith('..')) {
          throw new Error(`Compiler configuration escapes ${checked.name}`)
        }
        return { config, workspace, environment: project.environment }
      })
    }),
  )
  return programs.flat()
}
const Diagnostics = Schema.Struct({
  diagnostics: Schema.Array(
    Schema.Struct({
      severity: Schema.String,
      name: Schema.String,
      message: Schema.String,
    }),
  ),
  files: Schema.Array(Schema.Struct({ file: Schema.String })),
  summary: Schema.Struct({
    filesChecked: Schema.Number,
    filesWithoutPlugin: Schema.Number,
    totalFiles: Schema.Number,
    errors: Schema.Number,
  }),
})
const CompilerOptions = Schema.Struct({
  Effect: Schema.optional(
    Schema.NullOr(
      Schema.Struct({ diagnostics: Schema.optional(Schema.Boolean) }),
    ),
  ),
})
const checkDiagnosticsEnabled = async (config: string, directory: string) => {
  const compiler = new API({ cwd: directory, tsserverPath: getExePath() })
  try {
    const effective = await compiler.parseConfigFile(config)
    const options = Schema.decodeUnknownSync(CompilerOptions)(effective.options)
    if (options.Effect?.diagnostics !== true) {
      throw new Error(
        `Effect diagnostics must be enabled: ${relative(directory, config)}; configure @effect/language-service without diagnostics: false`,
      )
    }
  } finally {
    await compiler.close()
  }
}
const generatedDirectories = new Set([
  'node_modules',
  '.git',
  '.cache',
  '.alchemy',
  '.wrangler',
  'repos',
  'dist',
  'build',
  'coverage',
])
const isSource = (path: string) => /\.[cm]?tsx?$/u.test(path)
const isDeclaration = (path: string) => /\.d\.[cm]?ts$/u.test(path)
const contained = (parent: string, path: string) => {
  const local = relative(parent, path)
  return (
    local === '' ||
    (!isAbsolute(local) && local !== '..' && !local.startsWith('../'))
  )
}
const EffectiveConfig = Schema.Struct({ files: Schema.Array(Schema.String) })
const configFiles = async (project: CompilerProject, directory: string) => {
  const result = await run(
    ['bun', 'x', '--no-install', 'tsc', '--showConfig', '-p', project.config],
    false,
    directory,
  )
  return Schema.decodeUnknownSync(EffectiveConfig)(JSON.parse(result.stdout))
    .files.filter(isSource)
    .map((file) => resolve(dirname(project.config), file))
}
const sourceInventory = async (directory: string) => {
  const projects = await compilerProjects(directory)
  const workspaces = [...new Set(projects.map((project) => project.workspace))]
  const owners = await Promise.all(
    workspaces.map(async (workspace) => {
      const sources = new Set<string>()
      for await (const file of new Bun.Glob('**/*.{ts,tsx,mts,cts}').scan({
        cwd: workspace,
        onlyFiles: true,
      })) {
        const absolute = resolve(workspace, file)
        if (
          file.split('/').some((part) => generatedDirectories.has(part)) ||
          workspaces.some(
            (other) =>
              other !== workspace &&
              contained(workspace, other) &&
              contained(other, absolute),
          )
        ) {
          continue
        }
        sources.add(absolute)
      }
      const programs = await Promise.all(
        projects
          .filter((project) => project.workspace === workspace)
          .map(async (project) => ({
            project,
            files: new Set(await configFiles(project, directory)),
          })),
      )
      const missing = [...sources].filter(
        (file) => !programs.some((program) => program.files.has(file)),
      )
      if (missing.length > 0) {
        throw new Error(
          `Compiler declarations omit owned sources:\n${missing.sort().join('\n')}`,
        )
      }
      return { workspace, sources, programs }
    }),
  )
  return owners
}
export async function checkTypes(directory = root): Promise<void> {
  const owners = await sourceInventory(directory)
  for (const owner of owners) {
    const checked = new Set<string>()
    for (const { project, files } of owner.programs) {
      await checkDiagnosticsEnabled(project.config, directory)
      await run(
        ['bun', 'x', '--no-install', 'tsc', '--noEmit', '-p', project.config],
        false,
        directory,
      )
      const result = await run(
        [
          'bun',
          'x',
          '--no-install',
          'effect-tsgo',
          'diagnostics',
          '--project',
          project.config,
          '--format',
          'json',
          '--list-files',
        ],
        true,
        directory,
      )
      const diagnostics = Schema.decodeUnknownSync(Diagnostics)(
        JSON.parse(result.stdout),
      )
      for (const item of diagnostics.diagnostics.filter(
        (item) => item.severity === 'warning',
      )) {
        console.warn(`Effect warning ${item.name}: ${item.message}`)
      }
      const processed = new Set(
        diagnostics.files.map((file) => resolve(directory, file.file)),
      )
      const expected = [...files].filter((file) => !isDeclaration(file))
      const missing = expected.filter((file) => !processed.has(file))
      if (
        result.code !== 0 ||
        diagnostics.summary.errors !== 0 ||
        diagnostics.summary.filesChecked === 0 ||
        diagnostics.summary.filesWithoutPlugin !== 0 ||
        diagnostics.summary.filesChecked !== diagnostics.summary.totalFiles ||
        missing.length > 0
      ) {
        throw new Error(
          `Effect diagnostics missing coverage or contain errors: ${project.config}\n${result.stdout}\nMissing: ${missing.join(', ')}`,
        )
      }
      for (const file of expected) {
        if (owner.sources.has(file) && processed.has(file)) checked.add(file)
      }
      console.log(
        `PASS types ${relative(directory, project.config)} (${project.environment}); Effect checked ${diagnostics.summary.filesChecked} files`,
      )
    }
    const missing = [...owner.sources].filter(
      (file) => !isDeclaration(file) && !checked.has(file),
    )
    if (missing.length > 0) {
      throw new Error(
        `Effect diagnostics omitted owned sources:\n${missing.sort().join('\n')}`,
      )
    }
    console.log(
      `PASS ownership ${relative(directory, owner.workspace) || '.'}; ${owner.sources.size} compiler roots, ${checked.size} Effect processed sources`,
    )
  }
}
const expectOmission = async (directory: string, file: string) => {
  try {
    await checkTypes(directory)
  } catch (error) {
    if (
      error instanceof Error &&
      error.message.includes('Compiler declarations omit owned sources:') &&
      error.message.includes(file)
    )
      return
    throw error
  }
  throw new Error(`Source omission counter was not rejected: ${file}`)
}
const checkOwnedFixtures = async (directory: string) => {
  const owners = await sourceInventory(directory)
  const fixtures = await Promise.all(
    owners.map(async (owner) => {
      const source = [...owner.sources].find((file) => !isDeclaration(file))
      if (source === undefined)
        throw new Error(`No source for ownership fixture: ${owner.workspace}`)
      const file = resolve(dirname(source), `__ownership_${process.pid}.ts`)
      const configs = await Promise.all(
        owner.programs.map(async ({ project }) => ({
          project,
          original: await Bun.file(project.config).text(),
        })),
      )
      const first = configs[0]
      if (first === undefined)
        throw new Error(`No program for ${owner.workspace}`)
      const value = Schema.decodeUnknownSync(
        Schema.Record(Schema.String, Schema.Unknown),
      )(JSON.parse(first.original))
      const selection = Schema.decodeUnknownSync(
        Schema.Struct({ files: Schema.optional(Schema.Array(Schema.String)) }),
      )(value)
      await Bun.write(
        first.project.config,
        JSON.stringify({
          ...value,
          files: [
            ...(selection.files ?? []),
            relative(dirname(first.project.config), file),
          ],
        }),
      )
      await Bun.write(file, 'export const ownershipFixture: number = 1\n')
      return { owner, file, configs }
    }),
  )
  await checkTypes(directory)
  for (const { owner, file, configs } of fixtures) {
    try {
      for (const { project, original } of configs) {
        const value = Schema.decodeUnknownSync(
          Schema.Record(Schema.String, Schema.Unknown),
        )(JSON.parse(original))
        const selection = Schema.decodeUnknownSync(
          Schema.Struct({
            exclude: Schema.optional(Schema.Array(Schema.String)),
            files: Schema.optional(Schema.Array(Schema.String)),
          }),
        )(value)
        const excluded = relative(dirname(project.config), file)
        await Bun.write(
          project.config,
          JSON.stringify({
            ...value,
            exclude: [...(selection.exclude ?? []), excluded],
            ...(selection.files === undefined
              ? {}
              : {
                  files: selection.files.filter(
                    (entry) => resolve(dirname(project.config), entry) !== file,
                  ),
                }),
          }),
        )
      }
      await Bun.write(file, 'export const ownershipFixture: number = "wrong"\n')
      await expectOmission(directory, file)
      console.log(
        `PASS source omission counter ${relative(directory, owner.workspace) || '.'}; legal counterpart compiled and Effect processed`,
      )
    } finally {
      for (const { project, original } of configs)
        await Bun.write(project.config, original)
      await rm(file)
    }
  }
}
const neutralProbes = [
  {
    name: 'DOM',
    token: 'document',
    source: 'export const __neutralFixture = document.title\n',
  },
  {
    name: 'Bun',
    token: 'Bun',
    source: 'export const __neutralFixture = Bun.version\n',
  },
  {
    name: 'Node',
    token: 'process',
    source: 'export const __neutralFixture = process.pid\n',
  },
]
const checkNeutralFixtures = async (
  directory: string,
  selectedConfig?: string,
) => {
  const owners = await sourceInventory(directory)
  const projects = owners.flatMap((owner) =>
    owner.programs.filter(
      ({ project }) =>
        project.environment === 'neutral' &&
        (selectedConfig === undefined || project.config === selectedConfig),
    ),
  )
  if (projects.length === 0)
    throw new Error('No declared neutral compiler program for fixtures.')
  for (const { project, files } of projects) {
    const source = [...files].find(
      (file) => !isDeclaration(file) && contained(project.workspace, file),
    )
    if (source === undefined)
      throw new Error(`No owned neutral root file: ${project.config}`)
    const original = await Bun.file(source).text()
    const compile = (allowFailure = false) =>
      run(
        [
          'bun',
          'x',
          '--no-install',
          'tsc',
          '--noEmit',
          '--pretty',
          'false',
          '-p',
          project.config,
        ],
        allowFailure,
        directory,
      )
    try {
      await Bun.write(
        source,
        `${original}\nexport const __neutralFixture: number = 1\n`,
      )
      await compile()
      for (const probe of neutralProbes) {
        await Bun.write(source, `${original}\n${probe.source}`)
        const bad = await compile(true)
        if (
          bad.code === 0 ||
          !bad.stdout.includes(probe.token) ||
          !bad.stdout.includes(relative(directory, source))
        ) {
          throw new Error(
            `Neutral compiler admitted ${probe.name} global: ${relative(directory, project.config)}\n${bad.stdout}${bad.stderr}`,
          )
        }
      }
      console.log(
        `PASS actual neutral ${relative(directory, project.config)} rejects DOM/Bun/Node globals; legal counterpart compiled`,
      )
    } finally {
      await Bun.write(source, original)
    }
  }
}
const checkNeutralPollutionCounters = async (directory: string) => {
  const projects = (await compilerProjects(directory)).filter(
    (project) => project.environment === 'neutral',
  )
  for (const project of projects) {
    const original = await Bun.file(project.config).text()
    const value = Schema.decodeUnknownSync(
      Schema.Record(Schema.String, Schema.Unknown),
    )(JSON.parse(original))
    const decoded = Schema.decodeUnknownSync(
      Schema.Struct({
        compilerOptions: Schema.optional(
          Schema.Record(Schema.String, Schema.Unknown),
        ),
      }),
    )(value)
    for (const pollution of [
      { name: 'DOM', options: { lib: ['ESNext', 'DOM'] } },
      { name: 'Bun', options: { types: ['bun'] } },
    ]) {
      try {
        await Bun.write(
          project.config,
          JSON.stringify({
            ...value,
            compilerOptions: {
              ...decoded.compilerOptions,
              ...pollution.options,
            },
          }),
        )
        let rejected = false
        try {
          await checkNeutralFixtures(directory, project.config)
        } catch (error) {
          if (
            !(error instanceof Error) ||
            !error.message.startsWith(
              `Neutral compiler admitted ${pollution.name} global:`,
            )
          )
            throw error
          rejected = true
        }
        if (!rejected)
          throw new Error(
            `Polluted neutral ${pollution.name} counter was not rejected: ${project.config}`,
          )
        console.log(
          `PASS polluted neutral ${pollution.name} counter ${relative(directory, project.config)}; clean counterpart compiled`,
        )
      } finally {
        await Bun.write(project.config, original)
      }
    }
  }
}
const checkCompilerFixtures = async () => {
  const directory = await mkdtemp(
    resolve(tmpdir(), 'starter-compiler-fixtures-'),
  )
  try {
    await cp(root, directory, {
      recursive: true,
      filter: (path) =>
        !relative(root, path)
          .split('/')
          .some((part) => generatedDirectories.has(part)),
    })
    const workspaces = new Set(
      (await compilerProjects(directory)).map((project) => project.workspace),
    )
    for (const workspace of workspaces) {
      const dependencies = resolve(
        root,
        relative(directory, workspace),
        'node_modules',
      )
      if (existsSync(dependencies)) {
        await symlink(dependencies, resolve(workspace, 'node_modules'), 'dir')
      }
    }
    await checkNeutralFixtures(directory)
    await checkNeutralPollutionCounters(directory)
    await checkOwnedFixtures(directory)
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
}
export async function checkTemplate(): Promise<void> {
  for (const project of await compilerProjects()) {
    await checkDiagnosticsEnabled(project.config, root)
  }
  const directory = resolve(root, '.cache', `negative-${process.pid}`)
  const { mkdir, rm } = await import('node:fs/promises')
  await mkdir(directory, { recursive: true })
  try {
    await Bun.write(
      resolve(directory, 'negative.ts'),
      "import { Effect } from 'effect'\nEffect.succeed(1)\n",
    )
    await Bun.write(
      resolve(directory, 'tsconfig.json'),
      JSON.stringify({
        extends: '../../tsconfig.base.json',
        include: ['negative.ts'],
      }),
    )
    await run([
      'bun',
      'x',
      '--no-install',
      'tsc',
      '--noEmit',
      '-p',
      resolve(directory, 'tsconfig.json'),
    ])
    const bad = await run(
      [
        'bun',
        'x',
        '--no-install',
        'effect-tsgo',
        'diagnostics',
        '--project',
        resolve(directory, 'tsconfig.json'),
        '--format',
        'json',
        '--list-files',
      ],
      true,
    )
    const decoded = Schema.decodeUnknownSync(Diagnostics)(
      JSON.parse(bad.stdout),
    )
    if (
      !decoded.diagnostics.some(
        (item) => item.name === 'floatingEffect' && item.severity === 'error',
      )
    ) {
      throw new Error(`Negative Effect fixture was not rejected: ${bad.stdout}`)
    }
    await Bun.write(
      resolve(directory, 'negative.ts'),
      "import { Effect } from 'effect'\nexport const value = Effect.succeed(1)\n",
    )
    const good = await run([
      'bun',
      'x',
      '--no-install',
      'effect-tsgo',
      'diagnostics',
      '--project',
      resolve(directory, 'tsconfig.json'),
      '--format',
      'json',
      '--list-files',
    ])
    const legal = Schema.decodeUnknownSync(Diagnostics)(JSON.parse(good.stdout))
    if (
      legal.summary.errors !== 0 ||
      legal.summary.filesChecked === 0 ||
      legal.summary.filesWithoutPlugin !== 0
    ) {
      throw new Error('Legal Effect counterpart failed.')
    }
    console.log(
      'PASS template negative Effect fixture; legal counterpart accepted',
    )
  } finally {
    await rm(directory, { recursive: true, force: true })
  }
  await checkCompilerFixtures()
}
