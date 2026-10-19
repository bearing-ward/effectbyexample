/**
 * @title Classifying with decisions
 * @difficulty intermediate
 * @summary `Decision` describes questions about one input: pick a label,
 * place it on a scale, or estimate a probability. A `DecisionModel` answers
 * all of them in one provider call and checks the answers, so you get
 * validated labels and probabilities instead of free text to parse.
 */

import { Console, Effect, Layer, Schema } from 'effect'
import { AiError, Decision, DecisionModel } from 'effect/ai'

const Ticket = Schema.Struct({ subject: Schema.String, body: Schema.String })

// One definition, three decisions. Descriptions are sent to the provider to
// explain each label.
const Triage = Decision.make({
  input: Ticket,
  decisions: {
    team: Decision.classify({
      instructions: 'Which team should handle this ticket?',
      criteria: { billing: 'Payments and invoices', technical: 'Bugs' },
    }),
    severity: Decision.rate({
      instructions: 'How badly is the customer affected?',
      criteria: ['cosmetic', 'degraded', 'blocking'],
    }),
    urgent: Decision.probability({
      instructions: 'The customer needs an answer today',
    }),
  },
})

// A provider receives the input encoded as JSON (`state`) and the decisions.
// Ours answers with fixed numbers. Real providers ask a model for them.
const FakeDecisions = Layer.effect(
  DecisionModel.DecisionModel,
  DecisionModel.make({
    decide: ({ state, decisions }) =>
      Console.log('provider got', state, Object.keys(decisions)).pipe(
        Effect.as({
          answers: {
            team: {
              _tag: 'Classify',
              label: 'billing',
              probabilities: { billing: 0.9, technical: 0.1 },
            },
            severity: {
              _tag: 'Rate',
              rating: 1.6,
              probabilities: { cosmetic: 0, degraded: 0.4, blocking: 0.6 },
            },
            urgent: { _tag: 'Probability', probability: 0.8 },
          },
          usage: { inputTokens: 40, outputTokens: 12 },
        } as const),
      ),
  }),
)

export const program = Effect.gen(function* () {
  const { answers } = yield* DecisionModel.decide(Triage, {
    input: { subject: 'Charged twice', body: 'Please fix this today.' },
  })

  // The answers are typed from the definition: `team.label` can only be
  // `billing` or `technical`.
  yield* Console.log(`team: ${answers.team.label}`)

  // For a rating, `rating` is the weighted position on the scale (0 to 2),
  // and `label` is the level with the highest probability.
  yield* Console.log(
    `severity: ${answers.severity.rating} (${answers.severity.label})`,
  )
  yield* Console.log(`urgent: ${answers.urgent.probability}`)

  // Answers are checked before you see them. A provider that returns a
  // label we never defined fails with an `InvalidOutputError`.
  const BadProvider = Layer.effect(
    DecisionModel.DecisionModel,
    DecisionModel.make({
      decide: () =>
        Effect.succeed({
          answers: {
            team: {
              _tag: 'Classify',
              label: 'sales',
              probabilities: { sales: 1 },
            },
          },
          usage: { inputTokens: undefined, outputTokens: undefined },
        }),
    }),
  )
  const error: AiError.AiError = yield* DecisionModel.decide(Triage, {
    input: { subject: 'Hi', body: 'Pricing?' },
  }).pipe(Effect.flip, Effect.provide(BadProvider))
  yield* Console.log(`${error.reason._tag}: ${error.reason.message}`)
}).pipe(Effect.provide(FakeDecisions))
