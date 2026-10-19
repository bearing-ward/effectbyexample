/**
 * @title SchemaParser and the issue tree
 * @difficulty advanced
 * @summary `Schema.decodeUnknownEffect` wraps failures in a `SchemaError`
 * with a message. `SchemaParser` gives you the raw `SchemaIssue` tree
 * instead, in whatever result type suits the caller, so you can walk it and
 * build your own error output.
 */

import {
  Console,
  Effect,
  Result,
  Schema,
  SchemaIssue,
  SchemaParser,
} from 'effect'

const Signup = Schema.Struct({
  email: Schema.String.check(Schema.isPattern(/@/)),
  age: Schema.Int.check(Schema.isGreaterThanOrEqualTo(13)),
  plan: Schema.Literals(['free', 'pro']),
})

// An `Issue` is a tree. `Pointer` nodes add a path, `Composite` and `AnyOf`
// group several issues, `Filter` and `Encoding` wrap the issue a check or
// transformation produced, and the leaves (`InvalidType`, `InvalidValue`,
// `MissingKey`, and so on) say what went wrong.
const collect = (
  issue: SchemaIssue.Issue,
  path: ReadonlyArray<PropertyKey> = [],
): Array<{ readonly field: string; readonly problem: string }> => {
  switch (issue._tag) {
    case 'Pointer':
      return collect(issue.issue, [...path, ...issue.path])
    case 'Composite':
    case 'AnyOf':
      return issue.issues.flatMap((inner) => collect(inner, path))
    case 'Encoding':
      return collect(issue.issue, path)
    case 'Filter':
      // A failed check knows what it expected.
      return [
        {
          field: path.join('.'),
          problem: `${issue.filter.annotations?.expected}`,
        },
      ]
    default:
      return [{ field: path.join('.'), problem: issue._tag }]
  }
}

export const program = Effect.gen(function* () {
  const input = { email: 'ada.example.com', age: 9.5 }

  // `decodeUnknownResult` returns a `Result` whose failure is the `Issue`
  // itself. `errors: 'all'` keeps going after the first problem.
  const result = SchemaParser.decodeUnknownResult(Signup)(input, {
    errors: 'all',
  })
  if (Result.isFailure(result)) {
    yield* Console.log(result.failure._tag, SchemaIssue.isIssue(result.failure))
    yield* Console.log(collect(result.failure))
  }

  // The same parser comes in other shapes: `Exit`, `Promise`, a throwing
  // `Sync`, or an `Effect` that fails with the `Issue`. Without
  // `errors: 'all'`, decoding stops at the first problem.
  yield* Console.log(SchemaParser.decodeUnknownExit(Signup)(input)._tag)
  const issue = yield* Effect.flip(
    SchemaParser.decodeUnknownEffect(Signup)(input),
  )
  yield* Console.log(collect(issue))

  // `makeOption` runs a schema's constructor checks, and `is` is a type
  // guard. Both come from the same module.
  yield* Console.log(
    SchemaParser.makeOption(Signup)({
      email: 'ada@example.com',
      age: 36,
      plan: 'pro',
    }),
  )
  yield* Console.log(SchemaParser.is(Signup)(input))
})
