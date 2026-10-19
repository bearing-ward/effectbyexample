/**
 * @title IP addresses
 * @difficulty beginner
 * @summary `NetAddress` parses IP addresses and `host:port` pairs into
 * immutable values instead of passing strings around. Parsing returns a
 * `Result`, and the values can be classified, compared, and formatted.
 */

// The networking modules live in `effect/net`. They are pure and run in any
// JavaScript runtime, including the browser. They are marked unstable.
import { Console, Effect, Equal, Result } from 'effect'
import { NetAddress } from 'effect/net'

export const program = Effect.gen(function* () {
  // Parsing returns a `Result`: the address, or a `NetAddressError` that
  // explains what is wrong.
  yield* Console.log(NetAddress.ipFromString('192.168.1.20'))
  const invalid = NetAddress.ipFromString('192.168.1.300')
  if (Result.isFailure(invalid)) {
    yield* Console.log(invalid.failure.message)
  }

  // Use the `Unsafe` variants for literals you know are valid. They throw on
  // bad input instead of returning a `Result`.
  const router = NetAddress.ipFromStringUnsafe('192.168.1.1')
  const localhost = NetAddress.ipFromStringUnsafe('127.0.0.1')

  // Classify addresses without memorising ranges.
  if (NetAddress.isIpv4Address(router)) {
    yield* Console.log('router private:', NetAddress.isPrivate(router))
  }
  yield* Console.log('localhost loopback:', NetAddress.isLoopback(localhost))

  // IPv6 addresses are normalised, so equal addresses compare equal however
  // they were written.
  const long = NetAddress.ipFromStringUnsafe(
    '2001:0db8:0000:0000:0000:0000:0000:0001',
  )
  const short = NetAddress.ipFromStringUnsafe('2001:db8::1')
  yield* Console.log(NetAddress.formatIp(long), Equal.equals(long, short))

  // An IPv4 client seen through an IPv6 socket arrives as `::ffff:a.b.c.d`.
  // `toCanonical` turns it back into the IPv4 address it is.
  const mapped = NetAddress.ipFromStringUnsafe('::ffff:10.0.0.7')
  yield* Console.log(NetAddress.formatIp(NetAddress.toCanonical(mapped)))

  // An internet address is an IP plus a port. Formatting adds the brackets
  // IPv6 needs in URLs.
  const api = NetAddress.inetAddressFromStringUnsafe('[2001:db8::1]:8443')
  yield* Console.log(api.port, NetAddress.formatUrlUnsafe(api, 'https'))
  const badPort = NetAddress.inetAddressFromString('10.0.0.1:70000')
  if (Result.isFailure(badPort)) {
    yield* Console.log(badPort.failure.message)
  }
})
