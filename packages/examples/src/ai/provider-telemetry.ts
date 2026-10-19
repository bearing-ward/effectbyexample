/**
 * @title Telemetry and IDs in a provider
 * @difficulty advanced
 * @summary Every `LanguageModel` call runs in a tracing span. Providers
 * annotate it with OpenTelemetry GenAI attributes through `Telemetry`, and
 * create IDs through the `IdGenerator` service. Both are plumbing you meet
 * when writing or testing a provider, not in everyday application code.
 */

import { Console, Effect, Layer, Random, Stream } from 'effect'
import { IdGenerator, LanguageModel, Telemetry } from 'effect/ai'

// Provider hooks may use `IdGenerator`, for example to name tool calls when
// the API does not. `LanguageModel.make` picks it up when the model is
// built and falls back to a default that makes IDs like `id_` + 16 random
// characters.
const FakeModel = Layer.effect(
  LanguageModel.LanguageModel,
  LanguageModel.make({
    generateText: (options) =>
      Effect.gen(function* () {
        const ids = yield* IdGenerator.IdGenerator
        const responseId = yield* ids.generateId()

        // `addGenAIAnnotations` writes attributes named by the OpenTelemetry
        // GenAI conventions, such as `gen_ai.usage.input_tokens`, onto the
        // span `LanguageModel` opened for this call.
        Telemetry.addGenAIAnnotations(options.span, {
          provider: { name: 'scripted' },
          request: { model: 'parcel-bot-1', temperature: 0 },
          response: { id: responseId, finishReasons: ['stop'] },
          usage: { inputTokens: 9, outputTokens: 3 },
        })
        return [{ type: 'text', text: 'Shipped today.' }] as const
      }),
    streamText: () => Stream.empty,
  }),
).pipe(
  // A custom generator: prefix `resp`, eight hex characters. The random part
  // comes from Effect's `Random` service.
  Layer.provide(
    IdGenerator.layer({
      alphabet: '0123456789abcdef',
      prefix: 'resp',
      separator: '_',
      size: 8,
    }),
  ),
)

// A `SpanTransformer` runs after each call with the request, the response
// parts, and the span. Use it to add your own attributes; here we copy the
// span's attributes out to see what was written. The first three, output
// type, tool choice, and concurrency, come from `LanguageModel` itself. The
// rest come from the provider.
const collectInto =
  (lines: Array<string>): Telemetry.SpanTransformer =>
  ({ span, response }) => {
    lines.push(`${span.name}: ${response.length} part(s)`)
    for (const [key, value] of span.attributes) {
      lines.push(`  ${key} = ${String(value)}`)
    }
  }

export const program = Effect.gen(function* () {
  const lines: Array<string> = []
  const response = yield* LanguageModel.generateText({
    prompt: 'Status?',
  }).pipe(
    Effect.provideService(Telemetry.CurrentSpanTransformer, collectInto(lines)),
  )
  yield* Console.log(response.text)
  yield* Console.log(lines.join('\n'))
}).pipe(
  Effect.provide(FakeModel),
  // Seeding `Random` makes the generated ID the same on every run, which is
  // what you want in tests.
  Random.withSeed('docs'),
)
