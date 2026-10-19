/**
 * @title Walking a schema's AST
 * @difficulty advanced
 * @summary Every schema carries a runtime description of itself in `.ast`: a
 * tree of nodes for strings, literals, objects, unions, and so on. Walk that
 * tree to generate docs, forms, or code from the schemas you already have.
 */

import { Console, Effect, Schema, SchemaAST } from 'effect'

const Order = Schema.Struct({
  id: Schema.String.check(Schema.isMinLength(3)).annotate({
    description: 'Public order number',
  }),
  quantity: Schema.NumberFromString,
  status: Schema.Literals(['pending', 'shipped']),
  giftNote: Schema.optionalKey(Schema.String),
  tags: Schema.Array(Schema.String),
}).annotate({ identifier: 'Order' })

// Each node has a `_tag`. Guards such as `isObjects` narrow the node so you
// can read its fields: `propertySignatures` on objects, `types` on unions,
// `literal` on literals, `rest` on arrays.
const render = (ast: SchemaAST.AST): string => {
  if (SchemaAST.isObjects(ast)) {
    const fields = ast.propertySignatures.map((property) => {
      // Optionality lives on the property's type node, not on the property.
      const optional = SchemaAST.isOptional(property.type) ? '?' : ''
      return `${String(property.name)}${optional}: ${render(property.type)}`
    })
    return `{ ${fields.join('; ')} }`
  }
  if (SchemaAST.isUnion(ast)) return ast.types.map(render).join(' | ')
  if (SchemaAST.isLiteral(ast)) return JSON.stringify(ast.literal)
  if (SchemaAST.isArrays(ast))
    return `Array<${ast.rest.map(render).join(', ')}>`
  return ast._tag.toLowerCase()
}

export const program = Effect.gen(function* () {
  yield* Console.log(SchemaAST.resolveIdentifier(Order.ast))

  // A schema has two sides. `toType` keeps the decoded side and `toEncoded`
  // the wire side, so `quantity` is a number on one and a string on the
  // other.
  yield* Console.log(render(SchemaAST.toType(Order.ast)))
  yield* Console.log(render(SchemaAST.toEncoded(Order.ast)))

  // Annotations and checks are on the nodes too. A check records what it
  // expects, which is enough to write field documentation.
  if (SchemaAST.isObjects(Order.ast)) {
    for (const { name, type } of Order.ast.propertySignatures) {
      const rules = (type.checks ?? []).map(
        (check) => check.annotations?.expected,
      )
      const description = SchemaAST.resolveDescription(type) ?? ''
      yield* Console.log(String(name), { description, rules })
    }
  }
})
