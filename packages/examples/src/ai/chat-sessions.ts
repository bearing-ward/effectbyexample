/**
 * @title Chat sessions and history
 * @difficulty intermediate
 * @summary A `Chat` keeps the conversation for you: each turn sends the whole
 * history plus the new message, then appends the reply. Histories export to
 * JSON so a session can be saved and resumed. With a `ResponseIdTracker`,
 * providers that support it receive only the new messages.
 */

import { Console, Effect, Layer, Ref, Stream } from 'effect'
import { Chat, LanguageModel, ResponseIdTracker } from 'effect/ai'

// The fake model reports what it was sent. It also returns a response ID in a
// `response-metadata` part, as providers like OpenAI's Responses API do.
const FakeModel = Layer.effect(
  LanguageModel.LanguageModel,
  Effect.gen(function* () {
    const calls = yield* Ref.make(0)
    return yield* LanguageModel.make({
      generateText: (options) =>
        Effect.gen(function* () {
          const n = yield* Ref.updateAndGet(calls, (count) => count + 1)
          const sent = options.incrementalPrompt ?? options.prompt
          const report =
            `got ${sent.content.length} of ${options.prompt.content.length}` +
            ` messages, previous=${options.previousResponseId ?? 'none'}`
          return [
            { type: 'response-metadata', id: `resp_${n}` },
            { type: 'text', text: report },
          ] as const
        }),
      streamText: () => Stream.empty,
    })
  }),
)

// The tracker remembers which messages each response already covered.
// `LanguageModel` checks for it on every call; without it, the full prompt
// is always sent.
const Tracker = Layer.effect(
  ResponseIdTracker.ResponseIdTracker,
  ResponseIdTracker.make,
)

export const program = Effect.gen(function* () {
  // Start from a system prompt. `Chat.empty` starts with no messages.
  const chat = yield* Chat.fromPrompt([
    { role: 'system', content: 'You are a helpful bakery assistant.' },
  ])

  // First turn: system + user. Nothing was sent before, so no previous ID.
  const first = yield* chat.generateText({ prompt: 'Do you have rye bread?' })
  yield* Console.log(first.text)

  // Second turn: history plus the new message makes four. The provider gets the
  // ID of the first response and only the new user message.
  const second = yield* chat.generateText({ prompt: 'Two loaves, please.' })
  yield* Console.log(second.text)

  // `history` is a `Ref` holding the `Prompt` so far.
  const history = yield* Ref.get(chat.history)
  yield* Console.log(history.content.map((message) => message.role))

  // Save the session as JSON, then resume it later, for example in another
  // request. The restored messages are new objects the tracker has never
  // seen, so the next call falls back to sending everything.
  const saved = yield* chat.exportJson
  const resumed = yield* Chat.fromJson(saved)
  const third = yield* resumed.generateText({ prompt: 'Add a croissant.' })
  yield* Console.log(third.text)
}).pipe(Effect.provide([FakeModel, Tracker]))
