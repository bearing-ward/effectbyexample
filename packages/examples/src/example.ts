import { Schema } from 'effect'

export const Difficulty = Schema.Literals([
  'beginner',
  'intermediate',
  'advanced',
])
export type Difficulty = typeof Difficulty.Type

/** `server` examples need Node or Bun APIs, so the site shows recorded output. */
export const ExampleRuntime = Schema.Literals(['browser', 'server'])
export type ExampleRuntime = typeof ExampleRuntime.Type

export const Segment = Schema.Struct({
  prose: Schema.String,
  code: Schema.String,
})
export type Segment = typeof Segment.Type

/** What lists and links need: everything from the header, no body. */
export const ExampleSummary = Schema.Struct({
  category: Schema.String,
  slug: Schema.String,
  title: Schema.String,
  difficulty: Difficulty,
  runtime: ExampleRuntime,
  summary: Schema.String,
})
export type ExampleSummary = typeof ExampleSummary.Type

export const Example = Schema.Struct({
  ...ExampleSummary.fields,
  segments: Schema.Array(Segment),
  source: Schema.String,
})
export type Example = typeof Example.Type

export const OutputLevel = Schema.Literals(['log', 'info', 'warn', 'error'])
export type OutputLevel = typeof OutputLevel.Type

export const OutputLine = Schema.Struct({
  level: OutputLevel,
  text: Schema.String,
})
export type OutputLine = typeof OutputLine.Type

export const Outcome = Schema.Literals(['succeeded', 'failed'])
export type Outcome = typeof Outcome.Type

export const Output = Schema.Struct({
  outcome: Outcome,
  lines: Schema.Array(OutputLine),
})
export type Output = typeof Output.Type

/** Dates readers see on a page: first added, last changed, last checked. */
export const ExampleHistory = Schema.Struct({
  key: Schema.String,
  added: Schema.String,
  updated: Schema.String,
  checked: Schema.String,
  effect: Schema.String,
})
export type ExampleHistory = typeof ExampleHistory.Type

/** Everything one example's page shows beyond its summary. */
export const ExamplePage = Schema.Struct({
  example: Example,
  maybeHistory: Schema.OptionFromNullOr(ExampleHistory),
  maybeOutput: Schema.OptionFromNullOr(Output),
})
export type ExamplePage = typeof ExamplePage.Type
