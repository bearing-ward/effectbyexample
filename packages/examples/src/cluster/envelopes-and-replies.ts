/**
 * @title Envelopes, messages, and replies
 * @difficulty advanced
 * @summary An entity client hides three layers of plumbing: an `Envelope`
 * that names the target and carries the payload, a `Message` that adds what
 * the sender needs to receive an answer, and a `Reply` that comes back. Most
 * code never touches them, but they explain what the cluster stores and
 * sends.
 */

import {
  Console,
  Context,
  Deferred,
  Effect,
  Exit,
  Layer,
  Option,
  Schema,
} from 'effect'
import {
  Entity,
  EntityAddress,
  EntityId,
  Envelope,
  Message,
  Reply,
  Sharding,
  TestRunner,
} from 'effect/cluster'
import { Headers } from 'effect/http'
import { Rpc } from 'effect/rpc'

const Greet = Rpc.make('Greet', {
  payload: { name: Schema.String },
  success: Schema.String,
})
const Greeter = Entity.make('Greeter', [Greet])

const GreeterLive = Greeter.toLayer(
  Greeter.of({
    Greet: ({ payload }) => Effect.succeed(`hello, ${payload.name}`),
  }),
)

export const program = Effect.gen(function* () {
  const sharding = yield* Sharding.Sharding

  // Step one: the address. It names the entity type, the id, and the shard.
  const entityId = EntityId.make('greeter-1')
  const address = EntityAddress.make({
    entityType: Greeter.type,
    entityId,
    shardId: yield* Greeter.getShardId(entityId),
  })

  // Step two: the envelope. Every request gets a unique id from the runner,
  // a snowflake, which is how storage and replies refer back to it.
  const requestId = yield* sharding.getSnowflake
  const envelope = Envelope.makeRequest<typeof Greet>({
    requestId,
    address,
    tag: 'Greet',
    payload: { name: 'Ada' },
    headers: Headers.empty,
  })
  yield* Console.log(`${envelope._tag} ${envelope.tag} to ${envelope.address}`)

  // Step three: the outgoing message. It wraps the envelope with the RPC
  // definition, used to encode the payload and decode the reply, and a
  // `respond` callback that receives the reply.
  const replied = yield* Deferred.make<Reply.Reply<typeof Greet>>()
  const message = new Message.OutgoingRequest({
    envelope,
    rpc: Greet,
    annotations: Greet.annotations,
    context: Context.empty(),
    lastReceivedReply: Option.none(),
    respond: (reply) => Deferred.succeed(replied, reply),
  })

  // `sendOutgoing` routes the message to the runner that owns the shard. An
  // entity client does exactly this for every call.
  yield* sharding.sendOutgoing(message, false)

  // A `Reply` is either a `Chunk` of a streamed response or a final
  // `WithExit`. It carries the request id it answers.
  const reply = yield* Deferred.await(replied)
  yield* Console.log(`reply: ${reply._tag}`)
  yield* Console.log(`answers our request: ${reply.requestId === requestId}`)
  if (Reply.WithExit.is(reply) && Exit.isSuccess(reply.exit)) {
    yield* Console.log(`value: ${reply.exit.value}`)
  }
}).pipe(Effect.provide(GreeterLive.pipe(Layer.provideMerge(TestRunner.layer))))
