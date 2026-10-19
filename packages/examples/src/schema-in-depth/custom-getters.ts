/**
 * @title Custom getters
 * @difficulty advanced
 * @summary A transformation is two getters, one for decoding and one for
 * encoding. Each getter is a small one-way step that can be composed, can
 * fail with an issue, and can even see whether a key was present at all.
 */

import {
  Console,
  Effect,
  Option,
  Schema,
  SchemaGetter,
  SchemaIssue,
} from 'effect'

// Compose ready-made getters with `compose`. This email field is trimmed and
// lower-cased on the way in, and written back unchanged with `passthrough`.
const Email = Schema.String.pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.trim().pipe(
      SchemaGetter.compose(SchemaGetter.toLowerCase()),
    ),
    encode: SchemaGetter.passthrough(),
  }),
)

// A getter receives an `Option`: `None` means the key was missing. That lets
// `transformOptional` supply a default when decoding and drop the default
// again when encoding, so stored rows stay small.
const Role = Schema.optionalKey(Schema.String).pipe(
  Schema.decodeTo(Schema.String, {
    decode: SchemaGetter.transformOptional((role) =>
      Option.orElseSome(role, () => 'member'),
    ),
    encode: SchemaGetter.transformOptional((role) =>
      Option.filter(role, (value) => value !== 'member'),
    ),
  }),
)

// `transformEffect` may fail. Return an `Issue` and it is reported like any
// other decoding problem, at the right path.
const Cents = Schema.String.pipe(
  Schema.decodeTo(Schema.Int, {
    decode: SchemaGetter.transformEffect((text: string) => {
      const match = /^\$(\d+)\.(\d{2})$/.exec(text)
      return match
        ? Effect.succeed(Number(match[1]) * 100 + Number(match[2]))
        : Effect.fail(
            new SchemaIssue.InvalidValue({
              message: `"${text}" is not a price like $1.50`,
            }),
          )
    }),
    encode: SchemaGetter.transform(
      (cents: number) =>
        `$${Math.floor(cents / 100)}.${String(cents % 100).padStart(2, '0')}`,
    ),
  }),
)

const Member = Schema.Struct({ email: Email, role: Role, credit: Cents })

export const program = Effect.gen(function* () {
  const decoded = Schema.decodeUnknownSync(Member)({
    email: '  Ada@Example.COM ',
    credit: '$12.05',
  })
  yield* Console.log(decoded)

  // Encoding runs the encode getters: the default role disappears again.
  yield* Console.log(Schema.encodeSync(Member)(decoded))
  yield* Console.log(Schema.encodeSync(Member)({ ...decoded, role: 'admin' }))

  const failure = yield* Schema.decodeUnknownEffect(Member)({
    email: 'a@b.c',
    credit: '12 dollars',
  }).pipe(
    Effect.as('decoded'),
    Effect.catchTag('SchemaError', (error) => Effect.succeed(error.message)),
  )
  yield* Console.log(failure)

  // A getter is an ordinary value. `SchemaGetter.run` runs one on its own,
  // which is handy for testing it in isolation.
  const slug = SchemaGetter.trim<string>().pipe(
    SchemaGetter.compose(SchemaGetter.toLowerCase()),
    SchemaGetter.map((text) => text.replaceAll(' ', '-')),
  )
  yield* Console.log(
    yield* SchemaGetter.run(slug, Option.some(' Summer Sale '), {}),
  )
})
