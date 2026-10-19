/**
 * @title Resolving hosts
 * @difficulty intermediate
 * @summary `Host` parses host names and `host:port` endpoints. `Dns` looks
 * names up, and `AddressResolver` turns an endpoint into the socket
 * addresses to connect to. Both are services, so a static zone can stand in
 * for real DNS in tests.
 */

// `Host`, `Dns`, and `AddressResolver` are marked experimental.
import { Console, Effect, Layer, Result } from 'effect'
import { AddressResolver, Dns, Host, NetAddress } from 'effect/net'

// Domain names are validated and lowercased when parsed.
const mailHost = Host.domainNameFromStringUnsafe('Mail.Shop.Example')

// `Dns.layerStatic` answers from a fixed zone instead of the network. Real
// programs use `NodeDns.layer` from `@effect/platform-node`, which asks the
// operating system, with `NodeAddressResolver.layer` on top.
const ZoneLive = Dns.layerStatic({
  hosts: {
    'api.shop.example': ['10.0.0.10', '10.0.0.11', '2001:db8::10'],
    'mail.shop.example': ['10.0.0.25'],
  },
  records: {
    'shop.example': [
      Dns.makeRecordUnsafe('MX', { exchange: mailHost, priority: 10 }),
    ],
  },
})

export const program = Effect.gen(function* () {
  yield* Console.log(mailHost)

  // An endpoint string becomes a `HostPort`. The host may be a domain name
  // or an IP address, and invalid input is a `Result` failure.
  const endpoint = Host.hostPortFromStringUnsafe('api.shop.example:443')
  yield* Console.log(endpoint.host, endpoint.port)
  const bad = Host.hostPortFromString('-api-.shop.example:443')
  if (Result.isFailure(bad)) {
    yield* Console.log(bad.failure._tag)
  }

  // `lookup` returns the addresses for a name, optionally of one family.
  const dns = yield* Dns.Dns
  const all = yield* dns.lookup('api.shop.example')
  const v4 = yield* dns.lookup('api.shop.example', { family: 'IPv4' })
  yield* Console.log(all.map(NetAddress.formatIp), v4.length)

  // `resolve` queries one record type, and `reverse` maps an address back
  // to its names.
  const mx = yield* dns.resolve('shop.example', 'MX')
  yield* Console.log(mx.map(Dns.formatRecord))
  yield* Console.log(yield* dns.reverse('10.0.0.25'))

  // A failed lookup is a `DnsError` with a reason.
  const missing = yield* dns.lookup('nope.shop.example').pipe(Effect.flip)
  yield* Console.log(missing.reason, missing.message)

  // `AddressResolver` combines both steps: parse the endpoint, look up the
  // name if needed, and attach the port to every address. A numeric host
  // skips DNS entirely.
  const resolver = yield* AddressResolver.AddressResolver
  const targets = yield* resolver.resolve('api.shop.example:443', {
    family: 'IPv4',
  })
  yield* Console.log(targets.map(NetAddress.formatInet))
  const direct = yield* resolver.resolve('[2001:db8::1]:8080')
  yield* Console.log(direct.map(NetAddress.formatInet))
}).pipe(Effect.provide(Layer.provideMerge(AddressResolver.layer(), ZoneLive)))
