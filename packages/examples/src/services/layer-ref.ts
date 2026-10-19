/**
 * @title Rebuilding a layer with LayerRef
 * @difficulty advanced
 * @summary `LayerRef` holds one layer-built service and lets you throw it
 * away and build it again, for example when an access token rotates. Code
 * keeps asking for the service as usual and gets the current one. The
 * module is marked unstable.
 */

import { Console, Context, Effect, Layer, LayerRef, Ref } from 'effect'

// An API client that signs in when it is built and signs out when it is
// released. Each build asks the token issuer for a new token.
class ApiClient extends Context.Service<
  ApiClient,
  { readonly get: (path: string) => Effect.Effect<string> }
>()('app/ApiClient') {
  static readonly layer = (issueToken: Effect.Effect<string>) =>
    Layer.effect(
      ApiClient,
      Effect.gen(function* () {
        const token = yield* Effect.acquireRelease(
          Effect.tap(issueToken, (token) =>
            Console.log(`sign in, got ${token}`),
          ),
          (token) => Console.log(`sign out ${token}`),
        )
        return ApiClient.of({
          get: (path) => Effect.succeed(`GET ${path} with ${token}`),
        })
      }),
    )
}

const fetchProfile = ApiClient.use((client) => client.get('/me'))

export const program = Effect.scoped(
  Effect.gen(function* () {
    // `LayerRef.make` builds lazily on first use. `idleTimeToLive` keeps the
    // client cached between uses instead of signing out after each call.
    const issued = yield* Ref.make(0)
    const issueToken = Ref.updateAndGet(issued, (n) => n + 1).pipe(
      Effect.map((n) => `token-${n}`),
    )
    const ref = yield* LayerRef.make(ApiClient.layer(issueToken), {
      idleTimeToLive: '1 hour',
    })

    // `ref.get` is a layer that provides the current client.
    yield* Console.log(yield* fetchProfile.pipe(Effect.provide(ref.get)))
    yield* Console.log(yield* fetchProfile.pipe(Effect.provide(ref.get)))

    // `refresh` releases the cached client and builds a new one right away.
    yield* ref.refresh
    yield* Console.log(yield* fetchProfile.pipe(Effect.provide(ref.get)))

    // Invalidation does not pull a client out from under code that is
    // using it. A borrower keeps its client until its own scope closes.
    yield* Effect.scoped(
      Effect.gen(function* () {
        const context = yield* ref.contextEffect
        yield* ref.invalidate
        const borrowed = Context.get(context, ApiClient)
        yield* Console.log('borrowed:', yield* borrowed.get('/orders'))
      }),
    )

    // The next use builds a fresh client.
    yield* Console.log(yield* fetchProfile.pipe(Effect.provide(ref.get)))
  }),
)
