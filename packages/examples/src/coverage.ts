import { Array, pipe } from 'effect'

import type { Category } from './catalog.ts'

/**
 * Module ids look like `Effect` for the root `effect` entry and
 * `http/HttpClient` for subpath entries such as `effect/http`.
 */
const importPattern =
  /import\s*\{([^}]*)\}\s*from\s*['"]effect(?:\/([a-z-]+))?['"]/gu

/** Value imports from `effect` and its subpaths; `type` imports are ignored. */
export const importedModules = (source: string): ReadonlyArray<string> =>
  pipe(
    [...source.matchAll(importPattern)],
    Array.flatMap((match) => {
      const subpath = match[2]
      return pipe(
        (match[1] ?? '').split(','),
        Array.map((name) => name.trim()),
        Array.filter((name) => name !== '' && !name.startsWith('type ')),
        Array.map((name) => name.split(/\s+as\s+/u)[0] ?? name),
        Array.map((name) =>
          subpath === undefined ? name : `${subpath}/${name}`,
        ),
      )
    }),
    Array.dedupe,
  )

export type Coverage = {
  /** Exported modules that no example imports, grouped by owning category. */
  readonly uncovered: ReadonlyArray<{
    readonly category: string
    readonly modules: ReadonlyArray<string>
  }>
  /** Exported modules that no category claims. */
  readonly unassigned: ReadonlyArray<string>
  readonly coveredCount: number
  readonly exportedCount: number
}

export const coverage = (
  exported: ReadonlyArray<string>,
  exempt: ReadonlyArray<string>,
  categories: ReadonlyArray<Category>,
  sources: ReadonlyArray<string>,
): Coverage => {
  const required = Array.filter(
    exported,
    (module) => !Array.contains(exempt, module),
  )
  const imported = Array.dedupe(Array.flatMap(sources, importedModules))
  const missing = Array.filter(
    required,
    (module) => !Array.contains(imported, module),
  )
  const claimed = Array.flatMap(categories, (category) => category.modules)
  return {
    uncovered: pipe(
      categories,
      Array.map((category) => ({
        category: category.title,
        modules: Array.filter(missing, (module) =>
          Array.contains(category.modules, module),
        ),
      })),
      Array.filter((group) => Array.isReadonlyArrayNonEmpty(group.modules)),
    ),
    unassigned: Array.filter(
      required,
      (module) => !Array.contains(claimed, module),
    ),
    coveredCount: required.length - missing.length,
    exportedCount: required.length,
  }
}

/** Value exports (`const`, `function`, `class`) declared in a `.d.ts` file. */
export const declaredValues = (declaration: string): ReadonlyArray<string> =>
  pipe(
    [
      ...declaration.matchAll(
        /^export declare (?:abstract )?(?:const|function|class) ([A-Za-z0-9_$]+)/gmu,
      ),
    ],
    Array.map((match) => match[1] ?? ''),
    Array.dedupe,
  )

/**
 * Names a source reads from a module as `Module.name`, where `Module` is the
 * module's import, possibly renamed with `as`.
 */
export const usedExports = (
  source: string,
  module: string,
): ReadonlyArray<string> => {
  const [subpath, name] = module.includes('/')
    ? module.split('/')
    : [undefined, module]
  const locals = pipe(
    [...source.matchAll(importPattern)],
    Array.filter((match) => match[2] === subpath),
    Array.flatMap((match) => (match[1] ?? '').split(',')),
    Array.map((specifier) => specifier.trim().split(/\s+as\s+/u)),
    Array.filter(([imported]) => imported === name),
    Array.map((parts) => parts[1] ?? parts[0] ?? ''),
  )
  return pipe(
    locals,
    Array.flatMap((local) => [
      ...source.matchAll(new RegExp(`\\b${local}\\.([A-Za-z0-9_$]+)`, 'gu')),
    ]),
    Array.map((match) => match[1] ?? ''),
    Array.dedupe,
  )
}

export type ExportCoverage = {
  /** Exported values that no example reads, grouped by module. */
  readonly uncovered: ReadonlyArray<{
    readonly module: string
    readonly exports: ReadonlyArray<string>
  }>
  readonly coveredCount: number
  readonly exportedCount: number
}

export const exportCoverage = (
  declared: ReadonlyArray<{
    readonly module: string
    readonly exports: ReadonlyArray<string>
  }>,
  exempt: ReadonlyArray<{ readonly module: string; readonly name: string }>,
  sources: ReadonlyArray<string>,
): ExportCoverage => {
  const groups = Array.map(declared, ({ module, exports }) => {
    const required = Array.filter(
      exports,
      (name) =>
        !Array.some(
          exempt,
          (entry) => entry.module === module && entry.name === name,
        ),
    )
    const used = Array.dedupe(
      Array.flatMap(sources, (source) => usedExports(source, module)),
    )
    return {
      module,
      required,
      exports: Array.filter(required, (name) => !Array.contains(used, name)),
    }
  })
  const exportedCount = Array.reduce(
    groups,
    0,
    (total, group) => total + group.required.length,
  )
  const missingCount = Array.reduce(
    groups,
    0,
    (total, group) => total + group.exports.length,
  )
  return {
    uncovered: pipe(
      groups,
      Array.filter((group) => Array.isReadonlyArrayNonEmpty(group.exports)),
      Array.map(({ module, exports }) => ({ module, exports })),
    ),
    coveredCount: exportedCount - missingCount,
    exportedCount,
  }
}
