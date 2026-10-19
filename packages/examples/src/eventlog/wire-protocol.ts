/**
 * @title What goes over the wire
 * @difficulty advanced
 * @summary `EventLogMessage` defines the sync protocol: five RPCs and the
 * binary messages they carry. Knowing it helps when you write a transport or a
 * server, or debug one. Here we build each message by hand, without a server.
 */

// The protocol is an `RpcGroup` of five RPCs. `Hello` and `Authenticate` set
// up a session. The other three carry the `EventLogAuthentication`
// middleware, so a server only runs them for an authenticated identity.
// `EventLogMessage` is marked unstable.
import { Console, Effect, Schema } from 'effect'
import { SchemaBinary } from 'effect/encoding'
import { EventJournal, EventLogMessage } from 'effect/eventlog'

const rpcs = [
  EventLogMessage.HelloRpc,
  EventLogMessage.AuthenticateRpc,
  EventLogMessage.WriteSingleRpc,
  EventLogMessage.WriteChunkedRpc,
  EventLogMessage.ChangesRpc,
]

const Todo = SchemaBinary.toCodec(
  Schema.Struct({ id: Schema.String, title: Schema.String }),
)

export const program = Effect.gen(function* () {
  for (const rpc of rpcs) {
    const middlewares: ReadonlySet<unknown> = rpc.middlewares
    const authenticated = middlewares.has(
      EventLogMessage.EventLogAuthentication,
    )
    yield* Console.log(rpc._tag, authenticated ? 'needs a session' : 'open')
  }

  // A write starts as journal entries. The payload is already binary: each
  // event encodes its payload with its schema before it reaches the journal.
  const entry = new EventJournal.Entry({
    id: EventJournal.makeEntryIdUnsafe(),
    event: 'TodoAdded',
    primaryKey: 'todo-1',
    payload: yield* Schema.encodeEffect(Todo)({
      id: 'todo-1',
      title: 'Buy milk',
    }),
  })

  // The unencrypted remote wraps them in `WriteEntriesUnencrypted` with the
  // identity's public key and the store id, and encodes that to bytes. The
  // encrypted remote does the same with `WriteEntries` and ciphertext.
  const write = new EventLogMessage.WriteEntriesUnencrypted({
    publicKey: 'user-1',
    storeId: EventLogMessage.StoreId.make('default'),
    entries: [entry],
  })
  const bytes = yield* write.encoded
  yield* Console.log('write is', bytes.byteLength, 'bytes')
  const received = yield* EventLogMessage.WriteEntriesUnencrypted.decode(bytes)
  yield* Console.log(received.entries.map((e) => e.event))

  // Bytes that fit in `ChunkedMessage.chunkSize` go in one `WriteSingle` call.
  // Anything larger, such as a photo attached to a todo, is split into parts
  // and sent with one `WriteChunked` call per part.
  yield* Console.log('chunk size', EventLogMessage.ChunkedMessage.chunkSize)
  const photo = new Uint8Array(1_200_000).fill(7)
  const parts = EventLogMessage.ChunkedMessage.split(1, photo)
  yield* Console.log(parts.map((part) => part.part))

  // The receiver keeps a join state per connection. `join` returns
  // `undefined` until the last part arrives, then the whole payload.
  const state = EventLogMessage.ChunkedMessage.initialJoinState()
  for (const part of parts) {
    const joined = EventLogMessage.ChunkedMessage.join(state, part)
    yield* Console.log(
      `part ${part.part[0]}:`,
      joined === undefined ? 'waiting' : `${joined.byteLength} bytes`,
    )
  }

  // Changes flow back as a stream. The server numbers each entry with a
  // sequence, encodes a batch with `ChangesRpc.encodeUnencrypted`, and frames
  // it as a `SingleMessage`, or as chunks when the batch is large.
  const batch = yield* EventLogMessage.ChangesRpc.encodeUnencrypted([
    new EventJournal.RemoteEntry({ remoteSequence: 1, entry }),
  ])
  const frame = new EventLogMessage.SingleMessage({ data: batch })
  yield* Console.log(frame._tag)
  const changes = yield* EventLogMessage.ChangesRpc.decodeUnencrypted(
    frame.data,
  )
  yield* Console.log(
    changes.map((c) => `#${c.remoteSequence} ${c.entry.primaryKey}`),
  )
})
