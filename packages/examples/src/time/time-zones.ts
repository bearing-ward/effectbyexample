/**
 * @title Time zones
 * @difficulty intermediate
 * @summary A `DateTime.Zoned` is an instant plus an IANA time zone. The
 * instant decides when something happens; the zone decides how it reads on
 * a wall clock. Keeping both lets you show one meeting in several cities
 * and do calendar math that respects daylight saving time.
 */

import { Console, DateTime, Duration, Effect } from 'effect'

export const program = Effect.gen(function* () {
  // A team lead in New York books a stand-up for Friday at 09:00 local
  // time.
  // `adjustForTimeZone: true` reads the input as New York wall-clock time.
  // Without it, the input would be read as UTC.
  const standUp = DateTime.makeZonedUnsafe('2025-03-07T09:00:00', {
    timeZone: 'America/New_York',
    adjustForTimeZone: true,
  })
  yield* Console.log(DateTime.formatIsoZoned(standUp))

  // The same instant, shown in other zones. `setZoneNamedUnsafe` changes
  // only the zone, never the instant.
  for (const zone of ['Europe/London', 'Asia/Tokyo']) {
    const there = DateTime.setZoneNamedUnsafe(standUp, zone)
    yield* Console.log(zone, DateTime.formatIsoOffset(there))
  }

  // Converting to UTC is the right form for storage and APIs.
  yield* Console.log(DateTime.formatIso(DateTime.toUtc(standUp)))

  // New York moves its clocks forward on 9 March 2025. Calendar math on a
  // zoned value keeps the wall-clock time, so the stand-up stays at 09:00.
  // Because the clocks jump, only 23 hours pass between Saturday's and
  // Sunday's meetings.
  const saturday = DateTime.add(standUp, { days: 1 })
  const sunday = DateTime.add(standUp, { days: 2 })
  yield* Console.log(DateTime.formatIsoOffset(saturday))
  yield* Console.log(DateTime.formatIsoOffset(sunday))
  yield* Console.log(Duration.format(DateTime.distance(saturday, sunday)))

  // Code that should follow the user's zone can read it from the
  // `CurrentTimeZone` service. `setZoneCurrent` attaches that zone, and the
  // layer below decides which zone it is.
  const forViewer = yield* DateTime.setZoneCurrent(standUp).pipe(
    Effect.provide(DateTime.layerCurrentZoneNamed('Europe/Berlin')),
  )
  yield* Console.log(
    DateTime.format(forViewer, {
      locale: 'de-DE',
      hour: '2-digit',
      minute: '2-digit',
      timeZoneName: 'short',
    }),
  )
})
