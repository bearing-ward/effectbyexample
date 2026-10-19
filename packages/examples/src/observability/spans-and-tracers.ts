/**
 * @title Spans and tracers
 * @difficulty intermediate
 * @summary A span records one named unit of work and the span it ran inside.
 * `Effect.withSpan` and `Effect.fn` create spans, and the `Tracer` service
 * decides what happens to them. A small in-memory tracer shows the tree
 * that an exporter would send to a tracing backend.
 */

import { Console, Effect, Exit, Logger, Option, Tracer } from 'effect'

// A `Tracer` has one job: create a `Span` whenever Effect starts one. This
// tracer reuses `NativeSpan`, the in-memory span Effect uses by default,
// and records each span when it ends. Real tracers, like the OTLP one, do
// the same but send the span over the network.
const recordingTracer = (finished: Array<Tracer.NativeSpan>) =>
  Tracer.make({
    span(options) {
      const span = new Tracer.NativeSpan(options)
      const end = span.end.bind(span)
      span.end = (endTime, exit) => {
        end(endTime, exit)
        finished.push(span)
      }
      return span
    },
  })

// `Effect.fn` with a name wraps each call in a span of that name, so
// reusable functions show up in traces without extra code.
const chargeCard = Effect.fn('chargeCard')(function* (cents: number) {
  // `annotateCurrentSpan` adds attributes to the innermost span.
  yield* Effect.annotateCurrentSpan('amountCents', cents)
  // With `tracerLogger` installed, a log line becomes an event on the
  // current span instead of console output.
  yield* Effect.log('authorized')
})

const checkout = Effect.gen(function* () {
  yield* Effect.succeed('reserved').pipe(Effect.withSpan('reserveStock'))
  yield* chargeCard(4999)
  // A failing span records its failure in the exit.
  yield* Effect.fail('label printer offline').pipe(
    Effect.withSpan('printLabel'),
    Effect.ignore,
  )
}).pipe(
  // `withSpan` names the whole checkout. Spans started inside it become its
  // children, and `attributes` are set when the span starts.
  Effect.withSpan('checkout', { attributes: { orderId: 'ord-1001' } }),
)

export const program = Effect.gen(function* () {
  const finished: Array<Tracer.NativeSpan> = []

  yield* checkout.pipe(
    Effect.withTracer(recordingTracer(finished)),
    Effect.provide(Logger.layer([Logger.tracerLogger])),
  )

  // Children end before their parent, so the parent prints last. Span and
  // trace IDs are random, so this page prints names instead.
  for (const span of finished) {
    const parent = Option.match(span.parent, {
      onNone: () => 'root',
      onSome: (parent) =>
        parent._tag === 'Span' ? `in ${parent.name}` : 'external',
    })
    const outcome =
      span.status._tag === 'Ended' && Exit.isSuccess(span.status.exit)
        ? 'ok'
        : 'failed'
    yield* Console.log(`${span.name} (${parent}) ${outcome}`)
    if (span.attributes.size > 0) {
      yield* Console.log('  attributes:', Object.fromEntries(span.attributes))
    }
    for (const [name] of span.events) {
      yield* Console.log('  event:', name)
    }
  }
})
