import { Option } from 'effect'
import { expect, test } from 'vitest'

import type { Category } from './catalog.ts'
import {
  type ContentLog,
  contentStatus,
  historyOf,
  pendingChanges,
  recordChanges,
  recordReviews,
} from './content-log.ts'

const empty: ContentLog = { entries: [] }
const day = (date: string) => ({ date, effect: '4.0.0' })

const added = recordChanges(
  empty,
  pendingChanges(empty, [
    { key: 'schema/a', hash: 'a1' },
    { key: 'schema/b', hash: 'b1' },
  ]),
  day('2026-01-01'),
)

test('new sources are pending as added, then nothing is pending', () => {
  expect(pendingChanges(empty, [{ key: 'schema/a', hash: 'a1' }])).toEqual([
    { key: 'schema/a', kind: 'added', hash: 'a1' },
  ])
  expect(
    pendingChanges(added, [
      { key: 'schema/a', hash: 'a1' },
      { key: 'schema/b', hash: 'b1' },
    ]),
  ).toEqual([])
})

test('edited and deleted sources are pending as modified and removed', () => {
  expect(pendingChanges(added, [{ key: 'schema/a', hash: 'a2' }])).toEqual([
    { key: 'schema/a', kind: 'modified', hash: 'a2' },
    { key: 'schema/b', kind: 'removed', hash: '' },
  ])
})

test('a removed example that comes back is added again', () => {
  const removed = recordChanges(
    added,
    pendingChanges(added, [{ key: 'schema/a', hash: 'a1' }]),
    day('2026-02-01'),
  )
  expect(
    pendingChanges(removed, [
      { key: 'schema/a', hash: 'a1' },
      { key: 'schema/b', hash: 'b1' },
    ]),
  ).toEqual([{ key: 'schema/b', kind: 'added', hash: 'b1' }])
})

test('history separates the last content change from the last check', () => {
  const modified = recordChanges(
    added,
    [{ key: 'schema/a', kind: 'modified', hash: 'a2' }],
    day('2026-03-01'),
  )
  const reviewed = recordReviews(modified, ['schema/a'], {
    date: '2026-05-01',
    effect: '4.1.0',
  })
  expect(historyOf(reviewed, 'schema/a')).toEqual(
    Option.some({
      key: 'schema/a',
      added: '2026-01-01',
      updated: '2026-03-01',
      checked: '2026-05-01',
      effect: '4.1.0',
    }),
  )
})

test('status flags unlogged, older-effect, stale, and empty-category content', () => {
  const categories: ReadonlyArray<Category> = [
    {
      id: 'schema',
      title: 'Schema',
      blurb: '',
      status: 'published',
      stability: 'stable',
      modules: [],
      slugs: ['a', 'b'],
    },
    {
      id: 'streams',
      title: 'Streams',
      blurb: '',
      status: 'planned',
      stability: 'stable',
      modules: [],
      slugs: [],
    },
  ]
  const reviewedB = recordReviews(added, ['schema/b'], {
    date: '2026-06-20',
    effect: '4.1.0',
  })
  const status = contentStatus(
    reviewedB,
    [
      { key: 'schema/a', hash: 'a1' },
      { key: 'schema/b', hash: 'b1' },
      { key: 'schema/c', hash: 'c1' },
    ],
    categories,
    {
      today: '2026-07-01',
      installedEffect: '4.1.0',
      maybeLatestEffect: Option.some('4.2.0'),
      staleAfterDays: 90,
    },
  )
  expect(status.attention.map((item) => item._tag)).toEqual([
    'Unlogged',
    'NewerEffectReleased',
    'CheckedAgainstOlderEffect',
    'NotReviewedRecently',
    'EmptyCategory',
  ])
  expect(status.histories.map((history) => history.key)).toEqual([
    'schema/a',
    'schema/b',
  ])
})
