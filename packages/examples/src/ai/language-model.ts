/**
 * @title A language model you can run offline
 * @difficulty beginner
 * @summary `LanguageModel` is the provider-neutral service your code talks to.
 * Real providers plug in from separate packages, but `LanguageModel.make` lets
 * you build a scripted one, which is how this site runs AI examples without a
 * network or an API key.
 */

import { Console, Effect, Layer, Stream } from 'effect'
import { LanguageModel, Model, Response } from 'effect/ai'

// A provider implements two hooks. `generateText` returns the whole answer as
// a list of response parts: text, tool calls, a finish part with token usage,
// and so on. The `Response` module defines every part. `streamText` returns
// parts one at a time. Our fake ignores the prompt and gives a fixed reply.
// The `effect/ai` modules are marked unstable, so expect changes.
const answer: Array<Response.PartEncoded> = [
  { type: 'text', text: 'Your order ships on Tuesday.' },
  {
    type: 'finish',
    reason: 'stop',
    usage: { inputTokens: { total: 12 }, outputTokens: { total: 6 } },
  },
]

const chunks: Array<Response.StreamPartEncoded> = [
  { type: 'text-start', id: 't1' },
  { type: 'text-delta', id: 't1', delta: 'Your order ' },
  { type: 'text-delta', id: 't1', delta: 'ships on ' },
  { type: 'text-delta', id: 't1', delta: 'Tuesday.' },
  { type: 'text-end', id: 't1' },
]

const FakeModel = LanguageModel.make({
  generateText: () => Effect.succeed(answer),
  streamText: () => Stream.fromIterable(chunks),
})

// `Model.make` wraps the service in a layer and records which provider and
// model it is. Provider packages such as `@effect/ai-openai` give you the same
// thing from calls like `OpenAiLanguageModel.model('gpt-5.2')`.
const Scripted = Model.make(
  'scripted',
  'parcel-bot-1',
  Layer.effect(LanguageModel.LanguageModel, FakeModel),
)

export const program = Effect.gen(function* () {
  // Application code only asks for "a language model". It never names the
  // provider, so swapping providers is a one-line change to the layer.
  const response = yield* LanguageModel.generateText({
    prompt: 'When does order 1042 ship?',
  })

  // The response has the raw parts plus helpers for the common fields.
  yield* Console.log(response.text)
  yield* Console.log(`finish reason: ${response.finishReason}`)
  yield* Console.log(`output tokens: ${response.usage.outputTokens.total}`)

  // `Model.ProviderName` and `Model.ModelName` tell you what is answering.
  yield* Console.log(
    `answered by ${yield* Model.ProviderName}/${yield* Model.ModelName}`,
  )

  // `streamText` yields parts as they arrive, so a UI can show text before
  // the model is done. Keep the `text-delta` parts to get the text chunks.
  yield* LanguageModel.streamText({ prompt: 'When does it ship?' }).pipe(
    Stream.filter((part) => part.type === 'text-delta'),
    Stream.runForEach((part) =>
      Console.log(`chunk: ${JSON.stringify(part.delta)}`),
    ),
  )
}).pipe(Effect.provide(Scripted))
