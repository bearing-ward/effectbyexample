/**
 * @title Inside an event definition
 * @difficulty intermediate
 * @summary Each event in a group is an `Event` value: a tag, a function that
 * names what the event is about, and schemas for its payload, result, and
 * errors. The payload schema also gives the compact binary encoding that the
 * journal stores and devices sync.
 */

import { Console, Effect, Schema } from 'effect'
import { Event, EventGroup, EventLog } from 'effect/eventlog'

class OutOfStock extends Schema.TaggedError<OutOfStock>()('OutOfStock', {
  sku: Schema.String,
}) {}

// `EventGroup.add` calls `Event.make` with the options you give it. Calling
// `Event.make` yourself gives the same value, outside any group.
const ItemAdded = Event.make({
  tag: 'ItemAdded',
  primaryKey: (item) => `cart-${item.cartId}`,
  payload: Schema.Struct({
    cartId: Schema.Int,
    sku: Schema.String,
    quantity: Schema.Int,
  }),
  success: Schema.Struct({ lineCount: Schema.Int }),
})

// A group keeps its events in `events`, keyed by tag.
const CartEvents = EventGroup.empty.add({
  tag: 'ItemAdded',
  primaryKey: (item) => `cart-${item.cartId}`,
  payload: ItemAdded.payload,
})

// `Event.Payload` and friends extract the TypeScript types from a
// definition, for code that builds or reads events elsewhere.
type ItemAddedPayload = Event.Payload<typeof ItemAdded>

export const program = Effect.gen(function* () {
  yield* Console.log(Event.isEvent(ItemAdded), ItemAdded.tag)
  yield* Console.log(
    Object.keys(CartEvents.events),
    Event.isEvent(CartEvents.events.ItemAdded),
  )

  // The primary key names what an event is about, and the journal stores it
  // with every entry. Here all events for one cart share a key.
  const payload: ItemAddedPayload = { cartId: 7, sku: 'MUG-01', quantity: 2 }
  yield* Console.log(ItemAdded.primaryKey(payload))

  // `payloadSchemaBinary` encodes the payload to bytes and back. This is the
  // form a journal entry holds, smaller than the same data as JSON.
  const bytes = yield* Schema.encodeEffect(ItemAdded.payloadSchemaBinary)(
    payload,
  )
  yield* Console.log(
    bytes instanceof Uint8Array,
    bytes.length,
    JSON.stringify(payload).length,
  )
  yield* Console.log(
    yield* Schema.decodeEffect(ItemAdded.payloadSchemaBinary)(bytes),
  )

  // `Event.addError` returns a new definition whose handlers may also fail
  // with the given error. `EventGroup.addError` does this for every event.
  const Guarded = Event.addError(ItemAdded, OutOfStock)
  yield* Console.log(
    Schema.is(Guarded.error)(new OutOfStock({ sku: 'MUG-01' })),
  )
  yield* Console.log(
    Schema.is(ItemAdded.error)(new OutOfStock({ sku: 'MUG-01' })),
  )

  // `EventGroup.isEventGroup` and `EventLog.isEventLogSchema` recognise
  // these values at runtime. That helps code that collects definitions it
  // did not write, such as building one schema from every group a module
  // exports (`import * as Features from './features'`).
  const Features: Record<string, unknown> = { CartEvents, ItemAdded }
  const groups = Object.values(Features).filter(EventGroup.isEventGroup)
  const AppLog = EventLog.schema(...groups)
  yield* Console.log(
    `groups found: ${groups.length}`,
    EventLog.isEventLogSchema(AppLog),
    EventLog.isEventLogSchema(CartEvents),
  )
})
