/**
 * @title Streaming files
 * @difficulty intermediate
 * @summary `readFileString` loads a whole file into memory. For large files,
 * `FileSystem.stream` reads in chunks and `FileSystem.sink` writes from a
 * stream, so memory use stays flat however big the file gets.
 */

import { NodeServices } from '@effect/platform-node'
import { Console, Effect, FileSystem, Path, Stream } from 'effect'

export const program = Effect.gen(function* () {
  const fs = yield* FileSystem.FileSystem
  const path = yield* Path.Path
  const directory = yield* fs.makeTempDirectoryScoped({ prefix: 'sales-' })
  const file = path.join(directory, 'sales.csv')

  // Write a CSV from a stream of rows. `fs.sink` consumes bytes, so the rows
  // are encoded as UTF-8 text first. The stream produces rows as the sink
  // writes them, so the same code works for a file larger than memory.
  const rows = Stream.range(1, 1000).pipe(
    Stream.map((n) => `order-${n},${(n % 7) + 1}\n`),
  )
  yield* Stream.make('order,quantity\n').pipe(
    Stream.concat(rows),
    Stream.encodeText,
    Stream.run(fs.sink(file)),
  )
  const info = yield* fs.stat(file)
  yield* Console.log(`wrote ${info.size} bytes`)

  // Read it back in 4 KiB chunks. Counting them shows the file never arrived
  // in one piece.
  const chunks = yield* fs
    .stream(file, { chunkSize: 4096 })
    .pipe(Stream.runCount)
  yield* Console.log(`read in ${chunks} chunks`)

  // A chunk boundary can fall in the middle of a line. Decoding and
  // splitting lines as a stream handles that, so each element is one
  // complete row.
  const total = yield* fs.stream(file, { chunkSize: 4096 }).pipe(
    Stream.decodeText,
    Stream.splitLines,
    Stream.drop(1),
    Stream.map((line) => Number(line.split(',')[1])),
    Stream.runFold(
      () => 0,
      (sum, quantity) => sum + quantity,
    ),
  )
  yield* Console.log(`total quantity: ${total}`)

  // `bytesToRead` and `offset` read part of a file, such as its header.
  const header = yield* fs
    .stream(file, { bytesToRead: 14 })
    .pipe(Stream.decodeText, Stream.mkString)
  yield* Console.log(header)
}).pipe(Effect.scoped, Effect.provide(NodeServices.layer))
