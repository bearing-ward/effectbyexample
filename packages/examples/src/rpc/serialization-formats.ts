/**
 * @title Serialization formats
 * @difficulty intermediate
 * @summary Clients and servers exchange small messages: a request, chunks of
 * a stream, a final exit. `RpcSerialization` decides how those messages look
 * on the wire. Pick JSON, newline-delimited JSON, or JSON-RPC 2.0 to suit the
 * transport and whoever is on the other end.
 */

import { Console, Effect } from 'effect'
import { RpcMessage, RpcSerialization } from 'effect/rpc'

// These are the encoded messages for one call. `RpcMessage` defines every
// message type; the client and server build them for you.
const request: RpcMessage.FromClientEncoded = {
  _tag: 'Request',
  id: '1',
  tag: 'AddTodo',
  payload: { title: 'Buy milk' },
  headers: [],
}
const response: RpcMessage.FromServerEncoded = {
  _tag: 'Exit',
  requestId: '1',
  exit: { _tag: 'Success', value: { id: 1, title: 'Buy milk' } },
}

// Each format makes a parser. `encode` turns one message into a string or
// bytes, and `decode` turns received data back into messages.
const show = (
  name: string,
  format: RpcSerialization.RpcSerialization['Service'],
) =>
  Effect.gen(function* () {
    const parser = format.makeUnsafe()
    yield* Console.log(`${name} (${format.contentType})`)
    yield* Console.log(parser.encode(request))
    yield* Console.log(parser.encode(response))
  })

export const program = Effect.gen(function* () {
  // Plain JSON sends Effect's own message shapes. Use it where each message
  // already arrives on its own, as with WebSocket frames or a worker.
  yield* show('json', RpcSerialization.json)

  // JSON-RPC 2.0 maps the same messages onto the standard envelope, so tools
  // and clients outside Effect can speak to your server.
  yield* show('jsonRpc', RpcSerialization.jsonRpc())

  // Newline-delimited formats add their own framing, for transports that
  // deliver a byte stream: an HTTP body, a socket, stdin. The parser buffers
  // a partial message until its newline arrives.
  const parser = RpcSerialization.ndjson.makeUnsafe()
  yield* Console.log(
    `ndjson framing: ${RpcSerialization.ndjson.includesFraming}`,
  )
  yield* Console.log(parser.decode('{"_tag":"Pi'))
  yield* Console.log(parser.decode('ng"}\n{"_tag":"Eof"}\n'))

  // Decoding gives back the message the other side encoded. In an app you
  // provide a format as a layer, such as `RpcSerialization.layerNdjson` or
  // `layerJsonRpc()`, on both the client and the server.
  const roundTrip = RpcSerialization.jsonRpc().makeUnsafe()
  yield* Console.log(
    roundTrip.decode(
      '{"jsonrpc":"2.0","method":"AddTodo","params":{"title":"Buy milk"},"id":"1"}',
    ),
  )
})
