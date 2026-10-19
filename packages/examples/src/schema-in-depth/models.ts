/**
 * @title One model, many shapes with Model
 * @difficulty intermediate
 * @summary A user row, the JSON you send to a browser, and the payload for
 * creating a user are almost the same, but not quite. `Model.Class` declares
 * the fields once and derives a schema for each of those shapes.
 */

import { Console, Effect, Option, Schema } from 'effect'
import { Model } from 'effect/schema'

// `Model` is marked unstable. It powers the SQL modules in `effect/sql`,
// but the schemas it builds are ordinary schemas you can use anywhere.
const UserId = Schema.Int.pipe(Schema.brand('UserId'))

class User extends Model.Class<User>('User')({
  // The database assigns the id. `Model.Field` lists the variants a field
  // appears in: it can be read and is needed to update a row, but it is
  // never sent when creating one.
  id: Model.Field({ select: UserId, update: UserId, json: UserId }),
  email: Schema.String,
  // `Sensitive` fields stay in the database variants and never reach JSON.
  passwordHash: Model.Sensitive(Schema.String),
  // `FieldOption` is a nullable column in the database and an optional key
  // in JSON, and an `Option` in your code either way.
  nickname: Model.FieldOption(Schema.String),
  // SQLite has no booleans, so this column is stored as 0 or 1.
  isAdmin: Model.BooleanSqlite,
}) {}

export const program = Effect.gen(function* () {
  // `User` itself is the `select` variant: the shape of a row you read.
  // The others hang off it as static properties.
  const variants = {
    select: User,
    insert: User.insert,
    update: User.update,
    json: User.json,
    jsonCreate: User.jsonCreate,
    jsonUpdate: User.jsonUpdate,
  }
  for (const [name, schema] of Object.entries(variants)) {
    yield* Console.log(name.padEnd(10), Object.keys(schema.fields).join(', '))
  }

  // Decode a database row into a `User` instance.
  const user = Schema.decodeUnknownSync(User)({
    id: 1,
    email: 'ada@example.com',
    passwordHash: '$argon2id$...',
    nickname: null,
    isAdmin: 1,
  })
  yield* Console.log(user instanceof User, user.nickname, user.isAdmin)

  // Encode the same value for an API response. The hash is gone, and the
  // missing nickname is left out instead of being `null`.
  yield* Console.log(Schema.encodeSync(User.json)(user))

  // A create request decodes with `jsonCreate`. It has no `id` field, so a
  // client cannot choose one; an extra `id` key is ignored.
  const request = Schema.decodeUnknownSync(User.jsonCreate)({
    id: 999,
    email: 'grace@example.com',
    nickname: 'Amazing Grace',
    isAdmin: false,
  })
  yield* Console.log(request)

  // Prepare the insert: add the hash the server computed, then encode for
  // the database. The `Some` becomes a plain string (a `None` would become
  // `null`, as in the row above), and `false` becomes `0`.
  const row = Schema.encodeSync(User.insert)({
    ...request,
    passwordHash: '$argon2id$...',
    nickname: Option.some('Grace'),
  })
  yield* Console.log(row)
})
