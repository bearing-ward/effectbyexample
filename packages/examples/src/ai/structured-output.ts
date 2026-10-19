/**
 * @title Structured output with a schema
 * @difficulty intermediate
 * @summary `generateObject` asks the model for JSON that matches a `Schema`
 * and decodes the reply into a typed value. Each provider accepts a
 * different subset of JSON Schema, so `OpenAiStructuredOutput` and
 * `AnthropicStructuredOutput` turn your schema into a form the provider
 * accepts, while still decoding with your original rules.
 */

import { Console, Effect, type JsonSchema, Layer, Schema, Stream } from 'effect'
import {
  AnthropicStructuredOutput,
  LanguageModel,
  OpenAiStructuredOutput,
} from 'effect/ai'

const GiftOrder = Schema.Struct({
  sku: Schema.String.annotate({ description: 'Catalog product code' }),
  quantity: Schema.Int.check(Schema.isBetween({ minimum: 1, maximum: 10 })),
  giftNote: Schema.optional(Schema.String),
})

// Each helper returns the JSON Schema to send and a codec for the reply.
// Provider packages call them for you; here we call them to look. Both make
// the optional `giftNote` required but nullable, because strict structured
// output wants every property listed. OpenAI keeps the 1 to 10 bounds.
// Anthropic does not accept them and keeps only the generated description.
const openAi = OpenAiStructuredOutput.toCodecOpenAI(GiftOrder)
const anthropic = AnthropicStructuredOutput.toCodecAnthropic(GiftOrder)

// `jsonSchema` is plain JSON typed as unknown values, so read it by key.
const property = (schema: JsonSchema.JsonSchema, name: string) =>
  JSON.stringify((schema.properties as Record<string, unknown>)[name])

// A fake provider that replies with fixed JSON text. The `codecTransformer`
// tells `LanguageModel` how to decode that text: through the provider-safe
// codec, which turns `null` back into a missing field.
const replyingWith = (json: string) =>
  Layer.effect(
    LanguageModel.LanguageModel,
    LanguageModel.make({
      codecTransformer: AnthropicStructuredOutput.toCodecAnthropic,
      generateText: () => Effect.succeed([{ type: 'text', text: json }]),
      streamText: () => Stream.empty,
    }),
  )

const extractOrder = LanguageModel.generateObject({
  prompt: 'Two mugs (MUG-7), no note please.',
  schema: GiftOrder,
})

export const program = Effect.gen(function* () {
  yield* Console.log(
    'openai quantity:',
    property(openAi.jsonSchema, 'quantity'),
  )
  yield* Console.log(
    'anthropic quantity:',
    property(anthropic.jsonSchema, 'quantity'),
  )
  yield* Console.log(
    'required:',
    openAi.jsonSchema.required,
    anthropic.jsonSchema.required,
  )
  yield* Console.log('giftNote:', property(anthropic.jsonSchema, 'giftNote'))

  // The decoded `value` has the schema's type. `giftNote` came back as
  // `null` and is now absent, as the original schema expects.
  const response = yield* extractOrder.pipe(
    Effect.provide(
      replyingWith('{"sku":"MUG-7","quantity":2,"giftNote":null}'),
    ),
  )
  yield* Console.log(response.value)

  // The provider schema is looser than yours, but the codec is not. A
  // quantity of 20 fails with a `StructuredOutputError` even though
  // Anthropic was never told about the limit.
  const failure = yield* extractOrder.pipe(
    Effect.provide(
      replyingWith('{"sku":"MUG-7","quantity":20,"giftNote":null}'),
    ),
    Effect.flip,
  )
  yield* Console.log(`${failure.reason._tag}: ${failure.reason.message}`)
})
