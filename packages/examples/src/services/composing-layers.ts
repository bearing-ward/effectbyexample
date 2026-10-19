/**
 * @title Composing layers
 * @difficulty intermediate
 * @summary Real services depend on other services. Layers wire them
 * together: `Layer.provide` feeds one layer into another and hides it, while
 * `Layer.provideMerge` feeds it in and keeps it available to the program.
 */

import { Console, Context, Effect, Layer } from 'effect'

// The bottom of the graph: a database with no dependencies.
class Database extends Context.Service<
  Database,
  { readonly query: (sql: string) => Effect.Effect<number> }
>()('app/Database') {
  static readonly layer = Layer.effect(
    Database,
    Effect.gen(function* () {
      yield* Console.log('database: connecting')
      return Database.of({ query: (sql) => Effect.succeed(sql.length) })
    }),
  )
}

// Two services that need the database. Their layers have the type
// `Layer<Users, never, Database>`: the third parameter lists what the layer
// still needs before it can be built.
class Users extends Context.Service<
  Users,
  { readonly count: Effect.Effect<number> }
>()('app/Users') {
  static readonly layer = Layer.effect(
    Users,
    Effect.gen(function* () {
      const db = yield* Database
      return Users.of({ count: db.query('SELECT count(*) FROM users') })
    }),
  )
}

class Orders extends Context.Service<
  Orders,
  { readonly count: Effect.Effect<number> }
>()('app/Orders') {
  static readonly layer = Layer.effect(
    Orders,
    Effect.gen(function* () {
      const db = yield* Database
      return Orders.of({ count: db.query('SELECT count(*) FROM orders') })
    }),
  )
}

// `Layer.provide` satisfies the database requirement of both layers and
// leaves it out of the result: `Layer<Users | Orders>`. Code using this
// layer cannot reach the database directly, which keeps it an
// implementation detail.
const AppLayer = Layer.mergeAll(Users.layer, Orders.layer).pipe(
  Layer.provide(Database.layer),
)

// `Layer.provideMerge` does the same wiring but also exposes the provided
// service: `Layer<Users | Database>`. Use it when the program, or a test,
// needs the lower-level service too.
const UsersWithDatabase = Users.layer.pipe(Layer.provideMerge(Database.layer))

export const program = Effect.gen(function* () {
  yield* Effect.gen(function* () {
    const users = yield* Users
    const orders = yield* Orders
    yield* Console.log('users:', yield* users.count)
    yield* Console.log('orders:', yield* orders.count)
    /* yield* Database here would be a type error: AppLayer hides it. */
  }).pipe(Effect.provide(AppLayer))

  // The two services above shared one database: it connected once. Each
  // `Effect.provide` builds its own graph, so this second block connects
  // again and gets its own database.
  yield* Effect.gen(function* () {
    const users = yield* Users
    const db = yield* Database
    yield* Console.log('users:', yield* users.count)
    yield* Console.log('raw query:', yield* db.query('SELECT 1'))
  }).pipe(Effect.provide(UsersWithDatabase))
})
