/**
 * @title Rebuilding state from the journal
 * @difficulty advanced
 * @summary State derived from events can always be thrown away and rebuilt.
 * `EventLog.makeReplayFromRemote` builds the function the log uses to apply
 * synced entries, and you can feed it the journal's own entries to rebuild a
 * read model from scratch.
 */

import { Console, Effect, Layer, Ref, Schema } from 'effect'
import {
  EventGroup,
  EventJournal,
  EventLog,
  EventLogEncryption,
} from 'effect/eventlog'
import { Reactivity } from 'effect/reactivity'

const CartEvents = EventGroup.empty
  .add({
    tag: 'ItemAdded',
    primaryKey: (item) => item.sku,
    payload: Schema.Struct({ sku: Schema.String, quantity: Schema.Int }),
  })
  .add({
    tag: 'ItemRemoved',
    primaryKey: (item) => item.sku,
    payload: Schema.Struct({ sku: Schema.String }),
  })
const CartLog = EventLog.schema(CartEvents)

export const program = Effect.gen(function* () {
  // The read model: quantity per SKU. Imagine a cache or a search index
  // that you want to rebuild after changing how it is computed.
  const cart = yield* Ref.make<Record<string, number>>({})
  const CartHandlers = EventLog.group(CartEvents, (handlers) =>
    handlers
      .handle('ItemAdded', ({ payload }) =>
        Ref.update(cart, (items) => ({
          ...items,
          [payload.sku]: (items[payload.sku] ?? 0) + payload.quantity,
        })),
      )
      .handle('ItemRemoved', ({ payload }) =>
        Ref.update(cart, ({ [payload.sku]: _, ...rest }) => rest),
      ),
  )

  const CartLogLive = EventLog.layer(CartLog, CartHandlers).pipe(
    Layer.provide(EventJournal.layerMemory),
    // Keep the identity and the log's `Reactivity` visible to the program:
    // the replay below needs them.
    Layer.provideMerge(
      Layer.effect(EventLog.Identity, EventLog.makeIdentity).pipe(
        Layer.provide(EventLogEncryption.layerSubtle),
      ),
    ),
    Layer.merge(Reactivity.layer),
  )

  yield* Effect.gen(function* () {
    const write = yield* EventLog.makeClient(CartLog)
    yield* write('ItemAdded', { sku: 'MUG-01', quantity: 2 })
    yield* write('ItemAdded', { sku: 'TEE-M', quantity: 1 })
    yield* write('ItemRemoved', { sku: 'TEE-M' })
    yield* write('ItemAdded', { sku: 'MUG-01', quantity: 1 })
    yield* Console.log('live:', yield* Ref.get(cart))

    // Throw the read model away.
    yield* Ref.set(cart, {})
    yield* Console.log('cleared:', yield* Ref.get(cart))

    // The `Registry` holds the handlers that `EventLog.group` registered.
    // `makeReplayFromRemote` turns them into a function that decodes one
    // entry and runs its handler, with the store, identity, and reactivity
    // keys a handler expects.
    const registry = yield* EventLog.Registry
    const replay = EventLog.makeReplayFromRemote({
      handlers: registry.handlers,
      storeId: yield* EventLog.CurrentStoreId,
      identity: yield* EventLog.Identity,
      reactivity: yield* Reactivity.Reactivity,
      reactivityKeys: registry.reactivityKeys,
      logAnnotations: { service: 'CartRebuild', effect: 'replay' },
    })

    // Replay every entry in journal order. `conflicts` lists later entries
    // for the same key, which matters when merging another device's past
    // into yours; replaying your own journal has none.
    const log = yield* EventLog.EventLog
    for (const entry of yield* log.entries) {
      yield* replay({ entry, conflicts: [] })
    }
    yield* Console.log('rebuilt:', yield* Ref.get(cart))

    // The replay function catches and logs handler failures instead of
    // failing, so one bad entry does not stop a sync. Check the logs if a
    // rebuilt model looks incomplete.
  }).pipe(Effect.provide(CartLogLive))
})
