/**
 * @title One layer per tenant with LayerMap
 * @difficulty advanced
 * @summary A multi-tenant app often needs one database pool per customer,
 * built the first time that customer shows up. `LayerMap` builds a layer
 * per key on demand, reuses it while it is in use, and releases it when it
 * goes idle or the map closes. The module is marked unstable.
 */

import { Console, Context, Effect, Layer, LayerMap } from 'effect'

// The service the request code depends on. It does not know which tenant
// it serves; the layer it was built from decides that.
class TenantDb extends Context.Service<
  TenantDb,
  {
    readonly tenant: string
    readonly query: (sql: string) => Effect.Effect<string>
  }
>()('app/TenantDb') {
  // A layer factory: one pool per tenant, opened and closed as a resource.
  static readonly layer = (tenant: string) =>
    Layer.effect(
      TenantDb,
      Effect.acquireRelease(
        Effect.as(
          Console.log(`open pool for ${tenant}`),
          TenantDb.of({
            tenant,
            query: (sql) => Effect.succeed(`${tenant} ran ${sql}`),
          }),
        ),
        () => Console.log(`close pool for ${tenant}`),
      ),
    )
}

// `LayerMap.Service` defines the map as a service. `lookup` says how to
// build the layer for a key. `idleTimeToLive` keeps an unused pool around
// for a while, so back-to-back requests share it.
class TenantPools extends LayerMap.Service<TenantPools>()('app/TenantPools', {
  lookup: (tenant: string) => TenantDb.layer(tenant),
  idleTimeToLive: '1 minute',
}) {}

// Request handling code, written against `TenantDb` only.
const listOrders = TenantDb.use((db) => db.query('SELECT * FROM orders'))

// `TenantPools.get(key)` is a layer that provides `TenantDb` for that key.
const handle = (tenant: string) =>
  listOrders.pipe(Effect.provide(TenantPools.get(tenant)))

export const program = Effect.gen(function* () {
  // The first request for a tenant opens its pool. The second reuses it.
  yield* Console.log(yield* handle('acme'))
  yield* Console.log(yield* handle('acme'))
  yield* Console.log(yield* handle('globex'))

  // `invalidate` drops a tenant's pool, perhaps after its credentials
  // changed. The next request builds a fresh one.
  yield* TenantPools.invalidate('acme')
  yield* Console.log(yield* handle('acme'))

  yield* Console.log('shutting down')
}).pipe(
  // When the map's own layer is released, every pool still open is closed.
  Effect.provide(TenantPools.layer),
)
