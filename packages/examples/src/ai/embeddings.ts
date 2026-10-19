/**
 * @title Embeddings and similarity search
 * @difficulty intermediate
 * @summary An `EmbeddingModel` turns text into a vector of numbers, so that
 * texts with similar meaning get similar vectors. It is the basis of
 * semantic search. Single `embed` calls made at the same time are batched
 * into one provider request.
 */

import { Console, Effect, Layer } from 'effect'
import { EmbeddingModel } from 'effect/ai'

// A real model learns hundreds of dimensions. Ours counts three topics, which
// is enough to see how similarity search works.
const topics = [
  ['ship', 'delivery', 'arrive'],
  ['refund', 'return', 'money'],
  ['password', 'login', 'account'],
]
const embedText = (text: string) =>
  topics.map(
    (words) => words.filter((word) => text.toLowerCase().includes(word)).length,
  )

// `EmbeddingModel.make` only needs a batch function. It must return one
// vector per input, in the same order.
const FakeEmbeddings = Layer.effect(
  EmbeddingModel.EmbeddingModel,
  EmbeddingModel.make({
    embedMany: ({ inputs }) =>
      Console.log(`provider call with ${inputs.length} input(s)`).pipe(
        Effect.as({
          results: inputs.map(embedText),
          usage: { inputTokens: inputs.join(' ').split(' ').length },
        }),
      ),
  }),
)

const cosine = (a: ReadonlyArray<number>, b: ReadonlyArray<number>) => {
  const dot = a.reduce((sum, x, i) => sum + x * b[i]!, 0)
  const norm = (v: ReadonlyArray<number>) => Math.hypot(...v)
  return dot / (norm(a) * norm(b) || 1)
}

const articles = [
  'When will my delivery arrive?',
  'How do I get a refund for a return?',
  'Reset your password to unlock your account',
]

export const program = Effect.gen(function* () {
  const model = yield* EmbeddingModel.EmbeddingModel

  // `embedMany` sends a list in one call and reports token usage.
  const index = yield* model.embedMany(articles)
  yield* Console.log(`indexed ${index.embeddings.length} articles`)
  yield* Console.log(`input tokens: ${index.usage.inputTokens}`)

  // Three separate `embed` calls run concurrently. They are collected into a
  // single provider call, which saves round trips and rate limit budget.
  const queries = ['I want my money back', 'login trouble', 'ship date?']
  const vectors = yield* Effect.forEach(queries, model.embed, {
    concurrency: 'unbounded',
  })
  yield* Console.log(`${queries[0]}: [${vectors[0]!.vector.join(', ')}]`)

  // Search: pick the article whose vector points the same way as the query.
  for (const [i, query] of queries.entries()) {
    const scores = index.embeddings.map((article) =>
      cosine(vectors[i]!.vector, article.vector),
    )
    const best = scores.indexOf(Math.max(...scores))
    yield* Console.log(`${query} -> ${articles[best]}`)
  }
}).pipe(Effect.provide(FakeEmbeddings))
