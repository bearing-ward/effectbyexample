import { Array, Option, Order, pipe, Schema } from 'effect'

import type { Category } from './catalog.ts'
import type { ExampleHistory } from './example.ts'

/**
 * The content log is an append-only history of every example: when it was
 * added, changed, reviewed, or removed, and which Effect version it was
 * checked against at the time. `scripts/content.ts` maintains it.
 */
export const ChangeKind = Schema.Literals([
  'added',
  'modified',
  'reviewed',
  'removed',
])
export type ChangeKind = typeof ChangeKind.Type

export const IsoDate = Schema.String.check(
  Schema.isPattern(/^\d{4}-\d{2}-\d{2}$/u),
)

export const LogEntry = Schema.Struct({
  date: IsoDate,
  key: Schema.String,
  kind: ChangeKind,
  hash: Schema.String,
  effect: Schema.String,
  note: Schema.optionalKey(Schema.String),
})
export type LogEntry = typeof LogEntry.Type

export const ContentLog = Schema.Struct({ entries: Schema.Array(LogEntry) })
export type ContentLog = typeof ContentLog.Type

export type SourceFingerprint = { readonly key: string; readonly hash: string }

export type PendingChange = {
  readonly key: string
  readonly kind: 'added' | 'modified' | 'removed'
  readonly hash: string
}

const entriesFor = (log: ContentLog, key: string) =>
  Array.filter(log.entries, (entry) => entry.key === key)

const latest = (log: ContentLog, key: string) =>
  Array.last(entriesFor(log, key))

const isLive = (entry: LogEntry) => entry.kind !== 'removed'

const loggedKeys = (log: ContentLog) =>
  Array.dedupe(Array.map(log.entries, (entry) => entry.key))

/** Source changes that have not been written to the log yet. */
export const pendingChanges = (
  log: ContentLog,
  sources: ReadonlyArray<SourceFingerprint>,
): ReadonlyArray<PendingChange> => {
  const changed = Array.getSomes(
    Array.map(sources, (source) =>
      Option.match(Option.filter(latest(log, source.key), isLive), {
        onNone: () =>
          Option.some({
            key: source.key,
            kind: 'added' as const,
            hash: source.hash,
          }),
        onSome: (entry) =>
          entry.hash === source.hash
            ? Option.none()
            : Option.some({
                key: source.key,
                kind: 'modified' as const,
                hash: source.hash,
              }),
      }),
    ),
  )
  const removed = pipe(
    loggedKeys(log),
    Array.filter(
      (key) =>
        Option.exists(latest(log, key), isLive) &&
        !Array.some(sources, (source) => source.key === key),
    ),
    Array.map((key) => ({ key, kind: 'removed' as const, hash: '' })),
  )
  return [...changed, ...removed]
}

export type EntryContext = {
  readonly date: string
  readonly effect: string
  readonly note?: string
}

const toEntry = (
  change: {
    readonly key: string
    readonly kind: ChangeKind
    readonly hash: string
  },
  context: EntryContext,
): LogEntry => ({
  date: context.date,
  key: change.key,
  kind: change.kind,
  hash: change.hash,
  effect: context.effect,
  ...(context.note === undefined ? {} : { note: context.note }),
})

export const recordChanges = (
  log: ContentLog,
  changes: ReadonlyArray<PendingChange>,
  context: EntryContext,
): ContentLog => ({
  entries: [
    ...log.entries,
    ...Array.map(changes, (change) => toEntry(change, context)),
  ],
})

/** Marks examples as reviewed without a content change. */
export const recordReviews = (
  log: ContentLog,
  keys: ReadonlyArray<string>,
  context: EntryContext,
): ContentLog => ({
  entries: [
    ...log.entries,
    ...Array.getSomes(
      Array.map(keys, (key) =>
        Option.map(Option.filter(latest(log, key), isLive), (entry) =>
          toEntry({ key, kind: 'reviewed', hash: entry.hash }, context),
        ),
      ),
    ),
  ],
})

/** Dates readers see on a page: first added, last changed, last checked. */
export const historyOf = (
  log: ContentLog,
  key: string,
): Option.Option<ExampleHistory> => {
  const entries = entriesFor(log, key)
  return Option.map(Option.filter(Array.last(entries), isLive), (last) => {
    const changes = Array.filter(entries, (entry) => entry.kind !== 'reviewed')
    return {
      key,
      added: Option.match(Array.head(entries), {
        onNone: () => last.date,
        onSome: (first) => first.date,
      }),
      updated: Option.match(Array.last(changes), {
        onNone: () => last.date,
        onSome: (change) => change.date,
      }),
      checked: last.date,
      effect: last.effect,
    }
  })
}

export const Attention = Schema.TaggedUnion({
  Unlogged: { key: Schema.String, kind: Schema.String },
  CheckedAgainstOlderEffect: {
    key: Schema.String,
    checked: Schema.String,
    installed: Schema.String,
  },
  NotReviewedRecently: {
    key: Schema.String,
    checked: Schema.String,
    days: Schema.Number,
  },
  NewerEffectReleased: { installed: Schema.String, latest: Schema.String },
  EmptyCategory: { category: Schema.String },
})
export type Attention = typeof Attention.Type

export type StatusOptions = {
  readonly today: string
  readonly installedEffect: string
  readonly maybeLatestEffect: Option.Option<string>
  readonly staleAfterDays: number
}

export type ContentStatus = {
  readonly histories: ReadonlyArray<ExampleHistory>
  readonly attention: ReadonlyArray<Attention>
}

const daysBetween = (from: string, to: string) =>
  Math.floor((Date.parse(to) - Date.parse(from)) / 86_400_000)

const byKey = Order.mapInput(
  Order.String,
  (history: ExampleHistory) => history.key,
)

export const contentStatus = (
  log: ContentLog,
  sources: ReadonlyArray<SourceFingerprint>,
  categories: ReadonlyArray<Category>,
  options: StatusOptions,
): ContentStatus => {
  const histories = pipe(
    sources,
    Array.map((source) => historyOf(log, source.key)),
    Array.getSomes,
    Array.sort(byKey),
  )
  const unlogged = Array.map(pendingChanges(log, sources), (change) =>
    Attention.cases.Unlogged.make({ key: change.key, kind: change.kind }),
  )
  const olderEffect = Array.getSomes(
    Array.map(histories, (history) =>
      history.effect === options.installedEffect
        ? Option.none()
        : Option.some(
            Attention.cases.CheckedAgainstOlderEffect.make({
              key: history.key,
              checked: history.effect,
              installed: options.installedEffect,
            }),
          ),
    ),
  )
  const stale = Array.getSomes(
    Array.map(histories, (history) => {
      const days = daysBetween(history.checked, options.today)
      return days > options.staleAfterDays
        ? Option.some(
            Attention.cases.NotReviewedRecently.make({
              key: history.key,
              checked: history.checked,
              days,
            }),
          )
        : Option.none()
    }),
  )
  const newerEffect = pipe(
    options.maybeLatestEffect,
    Option.filter((latestEffect) => latestEffect !== options.installedEffect),
    Option.map((latestEffect) =>
      Attention.cases.NewerEffectReleased.make({
        installed: options.installedEffect,
        latest: latestEffect,
      }),
    ),
    Option.toArray,
  )
  const empty = pipe(
    categories,
    Array.filter((category) => Array.isReadonlyArrayEmpty(category.slugs)),
    Array.map((category) =>
      Attention.cases.EmptyCategory.make({ category: category.title }),
    ),
  )
  return {
    histories,
    attention: [
      ...unlogged,
      ...newerEffect,
      ...olderEffect,
      ...stale,
      ...empty,
    ],
  }
}

export const describeAttention = (attention: Attention): string =>
  Attention.match(attention, {
    Unlogged: ({ key, kind }) =>
      `${key}: ${kind} but not in the content log (run \`bun run content:log\`)`,
    CheckedAgainstOlderEffect: ({ key, checked, installed }) =>
      `${key}: last checked against effect ${checked}, installed is ${installed}; reread the prose for changed or better APIs`,
    NotReviewedRecently: ({ key, checked, days }) =>
      `${key}: not reviewed for ${days} days (since ${checked})`,
    NewerEffectReleased: ({ installed, latest }) =>
      `effect ${latest} is released; examples run against ${installed}`,
    EmptyCategory: ({ category }) =>
      `${category}: planned category with no examples yet`,
  })
