/**
 * @title Defining a service
 * @difficulty beginner
 * @summary A service is an interface your code asks for by name. Define it
 * with `Context.Service`, write code against it, and supply the
 * implementation later with a `Layer`.
 */

import { Console, Context, Effect, Layer, Schema } from 'effect'

class UserNotFound extends Schema.TaggedError<UserNotFound>()('UserNotFound', {
  id: Schema.String,
}) {}

// A service class takes two type parameters: the class itself and the
// shape of the service. The string is the service's unique key, so include
// your app name and a path to keep it from colliding with others.
class Users extends Context.Service<
  Users,
  {
    readonly findName: (id: string) => Effect.Effect<string, UserNotFound>
  }
>()('app/Users') {
  // By convention the implementation lives in a static `layer`.
  // `Layer.effect` builds the service with an Effect, so setup work can
  // run first. `Users.of` checks the object against the service shape.
  static readonly layer = Layer.effect(
    Users,
    Effect.gen(function* () {
      yield* Console.log('building Users')
      const names = new Map([
        ['u1', 'Ada'],
        ['u2', 'Grace'],
      ])
      const findName = Effect.fn('Users.findName')(function* (id: string) {
        const name = names.get(id)
        if (name === undefined) {
          return yield* new UserNotFound({ id })
        }
        return name
      })
      return Users.of({ findName })
    }),
  )
}

// Code that needs the service yields the class and gets the implementation
// back. The need is tracked in the type: this function returns
// `Effect<string, UserNotFound, Users>`.
const greet = Effect.fn('greet')(function* (id: string) {
  const users = yield* Users
  const name = yield* users.findName(id)
  return `Hello, ${name}`
})

export const program = Effect.gen(function* () {
  yield* Console.log(yield* greet('u1'))

  // `Users.use` is a shortcut for "get the service, then call it".
  yield* Console.log(yield* Users.use((users) => users.findName('u2')))

  const missing = yield* greet('u9').pipe(
    Effect.catchTag('UserNotFound', (error) =>
      Effect.succeed(`no user ${error.id}`),
    ),
  )
  yield* Console.log(missing)
}).pipe(
  // `Effect.provide` removes the `Users` requirement. Without it the program
  // does not typecheck. The layer is built once, before the program runs,
  // which is why "building Users" prints only once.
  Effect.provide(Users.layer),
)
