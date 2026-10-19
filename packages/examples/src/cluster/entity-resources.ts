/**
 * @title Resources that outlive an entity
 * @difficulty advanced
 * @summary An entity's in-memory state is rebuilt whenever the entity
 * restarts. Some things should not be torn down that often, like a container
 * or a pod the entity manages. `EntityResource` keeps them alive across
 * restarts and releases them only when you close them.
 */

import { Console, Effect, Layer, References, Ref, Schema, Scope } from 'effect'
import { Entity, EntityResource, TestRunner } from 'effect/cluster'
import { Rpc } from 'effect/rpc'

const Exec = Rpc.make('Exec', {
  payload: { command: Schema.String },
  success: Schema.String,
})
const Crash = Rpc.make('Crash')
const Shutdown = Rpc.make('Shutdown')
const Sandbox = Entity.make('Sandbox', [Exec, Crash, Shutdown])

export const program = Effect.gen(function* () {
  // A stand-in for Docker or Kubernetes: containers keep running until they
  // are removed, whatever happens to the code that started them.
  const containers = yield* Ref.make<ReadonlySet<string>>(new Set())
  const crashed = yield* Ref.make(false)

  const SandboxLive = Sandbox.toLayer(
    Effect.gen(function* () {
      const { entityId } = yield* Entity.CurrentAddress
      const name = `sandbox-${entityId}`
      yield* Console.log(`entity ${entityId} activated`)

      // `acquire` runs lazily, on the first `get`. It runs again after a
      // restart, so it should reattach to what is already there.
      const container = yield* EntityResource.make({
        acquire: Effect.gen(function* () {
          if ((yield* Ref.get(containers)).has(name)) {
            yield* Console.log(`reattached to ${name}`)
          } else {
            yield* Ref.update(containers, (all) => new Set([...all, name]))
            yield* Console.log(`started ${name}`)
          }
          // `CloseScope` is only closed by `close` or an idle timeout, not by
          // restarts. Put the real cleanup there.
          const closeScope = yield* EntityResource.CloseScope
          yield* Scope.addFinalizer(
            closeScope,
            Ref.update(
              containers,
              (all) => new Set([...all].filter((c) => c !== name)),
            ).pipe(Effect.andThen(Console.log(`removed ${name}`))),
          )
          return name
        }),
      })

      return Sandbox.of({
        Exec: ({ payload }) =>
          Effect.scoped(
            Effect.map(container.get, (c) => `${c} ran ${payload.command}`),
          ),
        // The first `Crash` is a defect, which restarts the entity. The
        // cluster then delivers the same message again, and it succeeds.
        Crash: () =>
          Effect.flatMap(Ref.getAndSet(crashed, true), (again) =>
            again ? Console.log('crash message retried') : Effect.die('boom'),
          ),
        Shutdown: () => container.close,
      })
    }),
  )

  yield* Effect.gen(function* () {
    const sandbox = (yield* Sandbox.client)('sb-1')
    yield* Console.log(yield* sandbox.Exec({ command: 'npm install' }))

    // The restart rebuilds the entity, but the container is not removed.
    yield* sandbox.Crash()
    yield* Console.log(yield* sandbox.Exec({ command: 'npm test' }))

    // Closing the resource runs the cleanup.
    yield* sandbox.Shutdown()
    yield* Console.log(`containers left: ${(yield* Ref.get(containers)).size}`)
  }).pipe(
    Effect.provide(SandboxLive.pipe(Layer.provideMerge(TestRunner.layer))),
    // The cluster logs the defect with a timestamp. We turn logging off to
    // keep the output stable.
    Effect.provideService(References.MinimumLogLevel, 'None'),
  )
})
