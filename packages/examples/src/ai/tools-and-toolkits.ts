/**
 * @title Tools and toolkits
 * @difficulty intermediate
 * @summary A `Tool` describes a function the model may call: its name,
 * parameter schema, and result schema. A `Toolkit` groups tools and gets
 * handlers from a layer. When the model asks for a tool, `generateText`
 * decodes the parameters, runs your handler, and returns the result.
 */

import { Console, Effect, Layer, Schema, Stream } from 'effect'
import { LanguageModel, Prompt, Tool, Toolkit } from 'effect/ai'

class OrderNotFound extends Schema.TaggedError<OrderNotFound>()(
  'OrderNotFound',
  { orderId: Schema.String },
) {}

// The description and schemas are sent to the model so it knows when and how
// to call the tool. `failureMode: 'return'` hands handler errors back to the
// model as a result instead of failing our program.
const GetOrderStatus = Tool.make('GetOrderStatus', {
  description: 'Look up the shipping status of an order',
  parameters: Schema.Struct({ orderId: Schema.String }),
  success: Schema.Struct({ status: Schema.String, eta: Schema.String }),
  failure: OrderNotFound,
  failureMode: 'return',
})

const SupportTools = Toolkit.make(GetOrderStatus)

// Handlers live in a layer, so they can depend on other services.
const SupportToolsLive = SupportTools.toLayer({
  GetOrderStatus: ({ orderId }) =>
    orderId === '1042'
      ? Effect.succeed({ status: 'in transit', eta: 'Tuesday' })
      : Effect.fail(new OrderNotFound({ orderId })),
})

// The fake model answers in text once it sees a tool result. Otherwise it
// calls the first tool it was offered, with the digits of the question.
const FakeModel = Layer.effect(
  LanguageModel.LanguageModel,
  LanguageModel.make({
    generateText: ({ prompt, tools }) => {
      const last = prompt.content.at(-1)!
      if (last.role === 'tool') {
        const results = last.content.map((part) =>
          part.type === 'tool-result' ? JSON.stringify(part.result) : '',
        )
        return Effect.succeed([
          { type: 'text', text: `model read tool result: ${results}` },
        ])
      }
      const question = JSON.stringify(last.content)
      return Effect.succeed([
        {
          type: 'tool-call',
          id: 'call_1',
          name: tools[0]!.name,
          params: { orderId: question.replace(/\D/g, '') },
        },
        {
          type: 'finish',
          reason: 'tool-calls',
          usage: { inputTokens: {}, outputTokens: {} },
        },
      ])
    },
    streamText: () => Stream.empty,
  }),
)

const ask = Effect.fn('ask')(function* (question: string) {
  // Yielding the toolkit gives a version with its handlers attached.
  const toolkit = yield* SupportTools
  const first = yield* LanguageModel.generateText({ prompt: question, toolkit })
  for (const call of first.toolCalls) {
    yield* Console.log(`call ${call.name}`, call.params)
  }
  for (const result of first.toolResults) {
    yield* Console.log(
      `result isFailure=${result.isFailure}`,
      JSON.stringify(result.encodedResult),
    )
  }

  // A single `generateText` stops after running tools. To let the model
  // read the results, send the response parts back as part of the prompt.
  // `Chat` does this bookkeeping for you.
  const prompt = Prompt.make(question).pipe(
    Prompt.concat(Prompt.fromResponseParts(first.content)),
  )
  const second = yield* LanguageModel.generateText({ prompt, toolkit })
  yield* Console.log(second.text)
})

export const program = Effect.gen(function* () {
  yield* ask('Where is order 1042?')
  yield* ask('Where is order 77?')
}).pipe(Effect.provide([FakeModel, SupportToolsLive]))
