/**
 * @title Tagged unions
 * @difficulty intermediate
 * @summary Model "one of several shapes" with a `_tag` field. Schema decodes
 * the right variant, and TypeScript narrows on the tag.
 */

import { Console, Effect, Schema } from 'effect'

// `Schema.TaggedUnion` takes one entry per variant and adds a literal `_tag`
// field to each.
const Shape = Schema.TaggedUnion({
  Circle: { radius: Schema.Number },
  Rectangle: { width: Schema.Number, height: Schema.Number },
  Triangle: { base: Schema.Number, height: Schema.Number },
})
type Shape = typeof Shape.Type

// `match` is exhaustive: leave out a variant and the compiler complains.
const area = (shape: Shape) =>
  Shape.match(shape, {
    Circle: ({ radius }) => Math.PI * radius ** 2,
    Rectangle: ({ width, height }) => width * height,
    Triangle: ({ base, height }) => (base * height) / 2,
  })

export const program = Effect.gen(function* () {
  // Decoding picks the variant from `_tag`.
  const shapes = yield* Schema.decodeUnknownEffect(Schema.Array(Shape))([
    { _tag: 'Circle', radius: 1 },
    { _tag: 'Rectangle', width: 2, height: 3 },
    { _tag: 'Triangle', base: 4, height: 5 },
  ])
  yield* Console.log(
    shapes.map((shape) => `${shape._tag}: ${area(shape).toFixed(2)}`),
  )

  // Each variant has its own constructor, which fills in `_tag` for you.
  yield* Console.log(Shape.cases.Circle.make({ radius: 2 }))

  // Guards narrow a `Shape` to one variant.
  yield* Console.log(shapes.filter(Shape.guards.Rectangle))
})
