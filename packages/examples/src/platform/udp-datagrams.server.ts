/**
 * @title UDP datagrams
 * @difficulty advanced
 * @summary A `DatagramSocket` sends and receives separate messages instead of
 * a byte stream. Each datagram arrives whole, carries the sender's address,
 * and may be lost on a real network. Here two sockets on this machine
 * exchange messages.
 */

// `DatagramSocket` lives in `effect/socket` and is marked experimental.
// `@effect/platform-node` provides a UDP implementation.
import { NodeDatagramSocket } from '@effect/platform-node'
import { Console, Effect, Stream } from 'effect'
import { NetAddress } from 'effect/net'
import { DatagramSocket } from 'effect/socket'

const decoder = new TextDecoder()

export const program = Effect.gen(function* () {
  // Bind two sockets to free ports on the loopback interface. A socket is
  // open once its reader is acquired, and the reader reports the bound
  // address.
  const server: DatagramSocket.DatagramSocket = yield* NodeDatagramSocket.make({
    bind: { address: '127.0.0.1', port: 0 },
  })
  const client = yield* NodeDatagramSocket.make({
    bind: { address: '127.0.0.1', port: 0 },
  })
  const serverReader = yield* server.reader
  const clientReader = yield* client.reader
  yield* Console.log(NetAddress.formatIp(serverReader.address.address))

  // The server answers every datagram. Each received `Datagram` has the
  // sender's address, so the reply goes straight back to it.
  const serverWriter = yield* server.writer
  yield* Effect.gen(function* () {
    while (true) {
      const datagrams = yield* serverReader.pull
      for (const datagram of datagrams) {
        const text = decoder.decode(datagram.payload)
        yield* serverWriter.write({
          payload: `ack: ${text}`,
          address: datagram,
        })
      }
    }
  }).pipe(Effect.forkScoped)

  // The client sends to the server's address. Every write is one datagram,
  // and the receiver gets the same boundaries back.
  const clientWriter = yield* client.writer
  yield* clientWriter.writeAll([
    { payload: 'ping 1', address: serverReader.address },
    { payload: 'ping 2', address: serverReader.address },
  ])

  // Read the replies. Over loopback nothing is lost; a real program would
  // add timeouts and retries, because UDP does not guarantee delivery.
  const replies = yield* Stream.fromEffectRepeat(clientReader.pull).pipe(
    Stream.flatMap((datagrams) => Stream.fromIterable(datagrams)),
    Stream.map((datagram) => decoder.decode(datagram.payload)),
    Stream.take(2),
    Stream.runCollect,
  )
  yield* Console.log(replies.toSorted())
}).pipe(Effect.scoped)
