/**
 * @title Generating JSON Schema
 * @difficulty intermediate
 * @summary The same schema that validates your data can describe it to other
 * tools. Generate JSON Schema for OpenAPI documents, form builders, or LLM
 * structured output.
 */

import { Console, Effect, JsonSchema, Schema } from 'effect'

// Annotations such as `description` flow into the generated document.
const Signup = Schema.Struct({
  email: Schema.String.check(Schema.isPattern(/@/)).annotate({
    description: 'Where we send the confirmation link',
  }),
  plan: Schema.Literals(['free', 'pro']),
  referralCode: Schema.optionalKey(Schema.String),
}).annotate({ title: 'Signup' })

export const program = Effect.gen(function* () {
  // `toJsonSchemaDocument` returns the root schema plus any shared
  // definitions.
  const document = Schema.toJsonSchemaDocument(Signup)
  yield* Console.log(JSON.stringify(document.schema, null, 2))

  // Effect generates JSON Schema draft 2020-12. Some tools still expect
  // draft-07, and the `JsonSchema` module converts between dialects.
  const draft07 = JsonSchema.toDocumentDraft07(document)
  yield* Console.log(`${document.dialect} -> ${draft07.dialect}`)
})
