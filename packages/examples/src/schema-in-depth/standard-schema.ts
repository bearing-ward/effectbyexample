/**
 * @title Standard Schema interop
 * @difficulty intermediate
 * @summary Standard Schema is a small shared interface that form libraries,
 * routers, and AI SDKs accept instead of depending on one validation
 * library. `Schema.toStandardSchemaV1` makes any Effect schema usable there.
 */

import { Console, Effect, Schema, StandardSchema } from 'effect'

// Pretend this function comes from a form library. It only knows the
// Standard Schema interface, vendored in `effect` as `StandardSchema`, and
// never imports Effect's `Schema`.
const submitForm = async <S extends StandardSchema.StandardSchemaV1>(
  schema: S,
  fields: unknown,
): Promise<
  | {
      readonly ok: true
      readonly value: StandardSchema.StandardSchemaV1.InferOutput<S>
    }
  | { readonly ok: false; readonly errors: Record<string, string> }
> => {
  // `validate` may return a result or a Promise of one.
  const result = await schema['~standard'].validate(fields)
  if (result.issues === undefined) return { ok: true, value: result.value }
  const errors: Record<string, string> = {}
  for (const issue of result.issues) {
    const key = (issue.path ?? [])
      .map((segment) =>
        String(typeof segment === 'object' ? segment.key : segment),
      )
      .join('.')
    errors[key] = issue.message
  }
  return { ok: false, errors }
}

// Form fields arrive as strings, so `age` uses a transformation. The
// library receives the decoded output, a real number.
const Signup = Schema.Struct({
  email: Schema.String.check(
    Schema.isPattern(/@/, { message: 'Enter an email' }),
  ),
  age: Schema.NumberFromString.check(Schema.isInt()),
})

// The result is still the same schema, with the `~standard` property added.
const SignupStandard = Schema.toStandardSchemaV1(Signup)

export const program = Effect.gen(function* () {
  yield* Console.log(
    SignupStandard['~standard'].vendor,
    SignupStandard['~standard'].version,
  )

  const accepted = yield* Effect.promise(() =>
    submitForm(SignupStandard, { email: 'ada@example.com', age: '36' }),
  )
  yield* Console.log(accepted)

  // Every problem is reported, each with the path the library needs to put
  // the message next to the right input.
  const rejected = yield* Effect.promise(() =>
    submitForm(SignupStandard, { email: 'ada', age: '36.5' }),
  )
  yield* Console.log(rejected)

  // Some tools also want a JSON Schema, for example to describe a tool to a
  // language model. `toStandardJSONSchemaV1` adds the converter they call.
  // `input` describes the raw fields, so `age` is a string here; `output`
  // describes the decoded value.
  const described = Schema.toStandardJSONSchemaV1(Signup)
  const jsonSchema = described['~standard'].jsonSchema.input({
    target: 'draft-2020-12',
  })
  yield* Console.log(jsonSchema)
})
