/**
 * @title Formatting issues and values
 * @difficulty intermediate
 * @summary The same issue tree can become a log message, a list of form
 * errors, or text in your own words. `SchemaIssue` ships the formatters and
 * the hooks to customize them, and `Formatter` renders the values that end
 * up inside those messages.
 */

import {
  Console,
  Effect,
  Formatter,
  Option,
  Redacted,
  Result,
  Schema,
  SchemaIssue,
  SchemaParser,
} from 'effect'

const Signup = Schema.Struct({
  // A `message` annotation replaces the default text for this check.
  email: Schema.String.check(
    Schema.isPattern(/@/, { message: 'Enter a valid email address' }),
  ),
  age: Schema.Int.check(Schema.isGreaterThanOrEqualTo(13)),
  plan: Schema.Literals(['free', 'pro']),
})

export const program = Effect.gen(function* () {
  // `reportInput: true` keeps the rejected values on the issues, so messages
  // can say what was received. Leave it off when inputs may be sensitive.
  const result = SchemaParser.decodeUnknownResult(Signup)(
    { email: 'ada', age: 9 },
    { errors: 'all', reportInput: true },
  )
  if (Result.isSuccess(result)) return
  const issue = result.failure

  // The default formatter gives one message per problem, each with its path.
  // `SchemaError.message` uses this one.
  yield* Console.log(SchemaIssue.makeFormatterDefault()(issue))

  // The Standard Schema formatter returns `{ issues: [{ path, message }] }`,
  // the shape form libraries expect.
  const standard = SchemaIssue.makeFormatterStandardSchemaV1()
  yield* Console.log(standard(issue).issues)

  // Hooks change the wording. `leafHook` handles leaves such as a missing
  // key; `checkHook` handles failed checks. Fall back to the default hooks
  // for everything else, or annotated messages are lost.
  const friendly = SchemaIssue.makeFormatterStandardSchemaV1({
    leafHook: (leaf) =>
      leaf._tag === 'MissingKey'
        ? 'This field is required'
        : SchemaIssue.defaultLeafHook(leaf),
    checkHook: (failed) =>
      failed.filter.annotations?.expected ===
      'a value greater than or equal to 13'
        ? 'You must be 13 or older'
        : SchemaIssue.defaultCheckHook(failed),
  })
  yield* Console.log(friendly(issue).issues.map((entry) => entry.message))

  // `Formatter.format` is how values such as `got 9` are rendered. Unlike
  // `JSON.stringify`, it handles bigints, sets, maps, dates, Options,
  // circular references, and hides `Redacted` values.
  const session: Record<string, unknown> = {
    userId: 42n,
    roles: new Set(['admin']),
    expires: new Date(Date.UTC(2025, 0, 1)),
    token: Redacted.make('s3cr3t'),
    referrer: Option.none(),
  }
  session['self'] = session
  yield* Console.log(Formatter.format(session))

  // `formatJson` produces valid JSON instead. It drops the circular
  // reference, redacts, and writes bigints as strings. Other values follow
  // `JSON.stringify`, so the set becomes `{}`.
  yield* Console.log(Formatter.formatJson(session))
})
