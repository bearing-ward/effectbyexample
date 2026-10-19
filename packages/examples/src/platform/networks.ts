/**
 * @title Networks and interfaces
 * @difficulty beginner
 * @summary CIDR notation such as `10.1.0.0/16` means two different things.
 * `IpNetwork` is a range of addresses, used for allow lists and routing.
 * `IpInterface` is one host's address plus the size of its network, as an
 * operating system reports it.
 */

import { Console, Effect, Result } from 'effect'
import { IpInterface, IpNetwork, NetAddress } from 'effect/net'

export const program = Effect.gen(function* () {
  // A network covers every address that shares its prefix.
  const office = IpNetwork.fromStringUnsafe('10.1.0.0/16')
  yield* Console.log(
    NetAddress.formatIp(IpNetwork.firstAddress(office)),
    NetAddress.formatIp(IpNetwork.lastAddress(office)),
    IpNetwork.addressCount(office),
  )

  // An allow list: is the client inside one of the trusted networks?
  const trusted = [office, IpNetwork.fromStringUnsafe('192.168.0.0/24')]
  const isTrusted = (client: string) => {
    const address = NetAddress.ipFromStringUnsafe(client)
    return trusted.some((network) => IpNetwork.contains(network, address))
  }
  yield* Console.log(isTrusted('10.1.200.3'), isTrusted('10.2.0.1'))

  // Networks can be compared with each other too.
  const lab = IpNetwork.fromStringUnsafe('10.1.4.0/24')
  yield* Console.log(
    IpNetwork.containsNetwork(office, lab),
    IpNetwork.overlaps(lab, IpNetwork.fromStringUnsafe('10.1.4.128/25')),
  )

  // A network must start at its first address. `10.1.2.3/16` has host bits
  // set, so it is rejected as a network.
  const sloppy = IpNetwork.fromString('10.1.2.3/16')
  if (Result.isFailure(sloppy)) {
    yield* Console.log(sloppy.failure.message)
  }

  // The same text is a valid interface: this machine is 10.1.2.3, on a /16.
  // The interface keeps its host address, and `IpNetwork.fromInterface` gives
  // the network it belongs to.
  const eth0 = IpInterface.fromStringUnsafe('10.1.2.3/16')
  yield* Console.log(NetAddress.formatIp(eth0.address), eth0.prefixLength)
  yield* Console.log(IpNetwork.format(IpNetwork.fromInterface(eth0)))
})
