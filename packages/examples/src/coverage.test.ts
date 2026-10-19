import { expect, test } from 'vitest'

import type { Category } from './catalog.ts'
import {
  coverage,
  declaredValues,
  exportCoverage,
  importedModules,
  usedExports,
} from './coverage.ts'

test('reads value imports from effect and its subpaths', () => {
  const source = [
    "import { Console, Effect, type Layer } from 'effect'",
    "import { HttpClient, HttpRouter as Router } from 'effect/http'",
    "import { readFile } from 'node:fs'",
  ].join('\n')
  expect(importedModules(source)).toEqual([
    'Console',
    'Effect',
    'http/HttpClient',
    'http/HttpRouter',
  ])
})

test('groups missing modules by category and lists unclaimed ones', () => {
  const category = (
    title: string,
    modules: ReadonlyArray<string>,
  ): Category => ({
    id: title,
    title,
    blurb: '',
    status: 'planned',
    stability: 'stable',
    modules,
    slugs: [],
  })
  const result = coverage(
    ['Effect', 'Option', 'Types', 'http/HttpClient', 'Graph'],
    ['Types'],
    [
      category('Basics', ['Effect', 'Option']),
      category('HTTP', ['http/HttpClient']),
    ],
    ["import { Effect } from 'effect'"],
  )
  expect(result).toEqual({
    uncovered: [
      { category: 'Basics', modules: ['Option'] },
      { category: 'HTTP', modules: ['http/HttpClient'] },
    ],
    unassigned: ['Graph'],
    coveredCount: 1,
    exportedCount: 4,
  })
})

test('reads value declarations from a .d.ts file', () => {
  const declaration = [
    'export declare const make: () => Log',
    'export declare function add(a: number): number',
    'export declare class StoreError {}',
    'export interface Log {}',
    'export type Id = string',
    'export declare namespace Log {}',
  ].join('\n')
  expect(declaredValues(declaration)).toEqual(['make', 'add', 'StoreError'])
})

test('finds the exports a source reads through a renamed import', () => {
  const source = [
    "import { EventLog as Log, Event } from 'effect/eventlog'",
    "import { Effect } from 'effect'",
    'const program = Log.layer(Event.make, Effect.void, Log.layer)',
  ].join('\n')
  expect(usedExports(source, 'eventlog/EventLog')).toEqual(['layer'])
  expect(usedExports(source, 'eventlog/Event')).toEqual(['make'])
  expect(usedExports(source, 'Effect')).toEqual(['void'])
})

test('reports exported values no source reads, minus exemptions', () => {
  const result = exportCoverage(
    [
      { module: 'eventlog/Event', exports: ['make', 'TypeId', 'isEvent'] },
      { module: 'eventlog/EventLog', exports: ['layer'] },
    ],
    [{ module: 'eventlog/Event', name: 'TypeId' }],
    ["import { Event } from 'effect/eventlog'\nEvent.make()"],
  )
  expect(result).toEqual({
    uncovered: [
      { module: 'eventlog/Event', exports: ['isEvent'] },
      { module: 'eventlog/EventLog', exports: ['layer'] },
    ],
    coveredCount: 1,
    exportedCount: 3,
  })
})
