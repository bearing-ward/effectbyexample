/**
 * @title Snowflake ids
 * @difficulty beginner
 * @summary The cluster names every message and reply with a snowflake: a
 * 64-bit id made of a timestamp, a machine id, and a sequence number. Any
 * runner can create ids without asking anyone else, and the ids still sort
 * by creation time.
 */

import { Console, DateTime, Effect } from 'effect'
import { MachineId, Snowflake } from 'effect/cluster'

export const program = Effect.gen(function* () {
  // `Snowflake.make` packs the three parts into a `bigint`. The timestamp
  // takes the high bits, then 10 bits of machine id, then 12 bits of
  // sequence.
  const id = Snowflake.make({
    timestamp: Date.UTC(2026, 0, 1),
    machineId: MachineId.make(7),
    sequence: 3,
  })
  yield* Console.log(`as a number: ${id}`)

  // The parts can be read back out. Timestamps count from 2025-01-01, the
  // snowflake epoch, which keeps the numbers small.
  const parts = Snowflake.toParts(id)
  yield* Console.log(
    `created at: ${DateTime.formatIso(Snowflake.dateTime(id))}`,
  )
  yield* Console.log(`machine: ${parts.machineId}, sequence: ${parts.sequence}`)

  // Ids travel as strings, because JSON numbers cannot hold 64 bits.
  // `Snowflake` turns a string back into the branded `bigint`.
  yield* Console.log(`round trip: ${Snowflake.Snowflake(String(id)) === id}`)

  // In a cluster, each runner has a generator. Its machine id comes from
  // runner storage when the runner registers, so no two runners share one.
  const generator = yield* Snowflake.makeGenerator
  yield* generator.setMachineId(MachineId.make(42))
  const ids = Array.from({ length: 5 }, () => generator.nextUnsafe())

  // Generated ids depend on the clock, so we print their structure, not
  // their values. All come from machine 42, and each is larger than the last
  // even within one millisecond, thanks to the sequence.
  yield* Console.log(
    `machines: ${[...new Set(ids.map(Snowflake.machineId))].join(', ')}`,
  )
  yield* Console.log(
    `increasing: ${ids.every((next, i) => i === 0 || next > ids[i - 1]!)}`,
  )
})
