/**
 * @title Defining an entity
 * @difficulty intermediate
 * @summary An entity is a stateful object that lives somewhere in your
 * cluster and is addressed by an id, like a shopping cart per customer. You
 * describe its messages as RPCs, write a handler, and call it by id without
 * knowing which machine runs it.
 */

// Cluster lives in `effect/cluster`. Like workflows, it is marked unstable,
// so its API can still change in a minor release.
import { Console, Effect, Layer, Ref, Schema } from 'effect'
import { Entity, TestRunner } from 'effect/cluster'
import { Rpc } from 'effect/rpc'

// Each message an entity accepts is an `Rpc` with schemas for its payload
// and reply. The schemas matter: in a real cluster the message may travel to
// another machine, so it has to be serializable.
const AddItem = Rpc.make('AddItem', {
  payload: { sku: Schema.String },
  success: Schema.Number,
})
const ListItems = Rpc.make('ListItems', {
  success: Schema.Array(Schema.String),
})

// `Entity.make` names the entity type and lists its protocol.
const Cart = Entity.make('Cart', [AddItem, ListItems])

// `toLayer` registers the behaviour. The effect you pass runs once per
// entity id, the first time a message for that id arrives, so it is the
// place to set up per-cart state.
const CartLive = Cart.toLayer(
  Effect.gen(function* () {
    // `CurrentAddress` tells the handler which entity it is.
    const address = yield* Entity.CurrentAddress
    yield* Console.log(`cart ${address.entityId} activated`)
    const items = yield* Ref.make<ReadonlyArray<string>>([])

    // Each handler receives a request whose `payload` is the decoded message,
    // and returns the reply.
    return Cart.of({
      AddItem: ({ payload }) =>
        Ref.updateAndGet(items, (skus) => [...skus, payload.sku]).pipe(
          Effect.map((skus) => skus.length),
        ),
      ListItems: () => Ref.get(items),
    })
  }),
)

export const program = Effect.gen(function* () {
  // `Cart.client` gives a function from entity id to a typed client. You
  // never say where the cart runs: the cluster routes the message.
  const makeClient = yield* Cart.client
  const alice = makeClient('alice')
  const bob = makeClient('bob')

  yield* alice.AddItem({ sku: 'tea' })
  yield* alice.AddItem({ sku: 'cups' })
  yield* bob.AddItem({ sku: 'coffee' })

  // The two ids are two separate carts, each with its own state.
  yield* Console.log(`alice's cart: ${(yield* alice.ListItems()).join(', ')}`)
  yield* Console.log(`bob's cart: ${(yield* bob.ListItems()).join(', ')}`)
}).pipe(
  // `TestRunner.layer` is a complete cluster in one process, with in-memory
  // storage and no network. It suits tests and examples. Entity layers need
  // a cluster, so it is provided underneath them.
  Effect.provide(CartLive.pipe(Layer.provideMerge(TestRunner.layer))),
)
