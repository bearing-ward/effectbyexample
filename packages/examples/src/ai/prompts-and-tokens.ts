/**
 * @title Prompts and token budgets
 * @difficulty intermediate
 * @summary A `Prompt` is a list of system, user, assistant, and tool
 * messages. You can pass a plain string, an array of messages, or a built
 * `Prompt`. A `Tokenizer` counts tokens and trims old messages so a long
 * conversation fits the model's context window.
 */

import { Console, Effect, Layer, Stream } from 'effect'
import { LanguageModel, Prompt, Tokenizer } from 'effect/ai'

// Renders a message as `role: text`, so we can see what the provider gets.
const render = (message: Prompt.Message): string =>
  typeof message.content === 'string'
    ? `${message.role}: ${message.content}`
    : `${message.role}: ${message.content
        .map((part) => (part.type === 'text' ? part.text : `[${part.type}]`))
        .join(' ')}`

// This fake model echoes the prompt it received, one message per line.
const EchoModel = Layer.effect(
  LanguageModel.LanguageModel,
  LanguageModel.make({
    generateText: ({ prompt }) =>
      Effect.succeed([
        { type: 'text', text: prompt.content.map(render).join('\n') },
      ]),
    streamText: () => Stream.empty,
  }),
)

// A toy tokenizer that counts words. Real tokenizers come with provider
// packages, because every model splits text differently.
const WordTokenizer = Tokenizer.make({
  tokenize: (prompt) =>
    Effect.succeed(
      prompt.content
        .flatMap((message) => render(message).split(' ').slice(1))
        .map((_, index) => index),
    ),
})

export const program = Effect.gen(function* () {
  // A string becomes one user message.
  const simple = yield* LanguageModel.generateText({ prompt: 'Hi there' })
  yield* Console.log(simple.text)

  // Messages can be written as plain objects. The user's `content` may be a
  // string; `Prompt.make` normalizes it into a list of parts.
  const history = Prompt.make([
    { role: 'user', content: 'Where is order 1042?' },
    {
      role: 'assistant',
      content: [{ type: 'text', text: 'It left the warehouse today.' }],
    },
  ])

  // Prompts are immutable values. `concat` appends a new turn and
  // `setSystem` replaces (or adds) the system message at the front.
  const next = history.pipe(
    Prompt.concat('When will it arrive?'),
    Prompt.setSystem('You are a shipping assistant.'),
  )
  const echoed = yield* LanguageModel.generateText({ prompt: next })
  yield* Console.log(echoed.text)

  // Count tokens before sending, for example to estimate cost.
  const tokens = yield* WordTokenizer.tokenize(next)
  yield* Console.log(`tokens: ${tokens.length}`)

  // `truncate` walks back from the newest message and keeps messages until
  // the next one would exceed the budget. With 6 tokens only the last
  // question fits. The system message is dropped too, so set it again.
  const trimmed = yield* WordTokenizer.truncate(next, 6)
  yield* Console.log(
    trimmed
      .pipe(Prompt.setSystem('You are a shipping assistant.'))
      .content.map(render),
  )
}).pipe(Effect.provide(EchoModel))
