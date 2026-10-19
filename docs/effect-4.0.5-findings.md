# Effect 4.0.5 findings

Behaviour found while writing and running the examples against `effect` 4.0.5. Items under "Likely bugs" are worth reporting upstream; the rest are things a reader coming from Effect 3, or from the docs, will trip over. The examples work around each of these, and most pages mention the relevant one.

## Likely bugs

- **`HttpMiddleware.cors`**: an `allowedOrigins` predicate is called with `undefined` when a request has no `Origin` header, although it is typed `string`. If a pre-response handler throws, the web handler never answers; the request hangs instead of returning 500.
- **`HttpClient.withCookiesRef`** keeps expired cookies and sends them with an empty value.
- **`HttpTraceContext.toHeaders`** crashes when given an external span; it needs a full `Span`.
- **`Effect.currentSpan` in an `HttpRouter` handler** fails under the default tracer because no request span is opened. Its `NoSuchElementError` is then mapped to a 404.
- **`@effect/sql-sqlite-node`**: `executeStream` dies with "not implemented", so `statement.stream` does not work on that driver.
- **`SqlEventJournal.entries`** orders entries by millisecond timestamp only, so entries written in the same millisecond have no stable order.
- **`EventLogServerUnencrypted`** reports a write refused by `EventLogServerAuthorization` as `Unauthorized`, even when the policy answered `Forbidden`.
- **`EventLog.makeReplayFromRemote`** catches every handler failure with `catchCause(logError)`, so a failed replay never reaches the caller.
- **`EventLogEncryption.decrypt`** with the wrong identity fails with a defect, not a typed error, because it wraps Web Crypto in `Effect.promise`.
- **`RunnerStorage.layerMemory`** (cluster) is only correct for one runner: `acquire` always succeeds and runners share one acquisition state.
- **`@foldkit/vite-plugin` 0.26–0.27.1** calls `crypto.randomUUIDv4.pipe`, but 4.0.5 made `randomUUIDv4` a method, so the DevTools MCP relay fails silently. This project patches it (see AGENTS.md).

## Documentation errors

- `ai-docs/src/05_batching/10_request-resolver.ts` says a `RequestResolver` removes duplicate requests. Only `RequestResolver.withCache` does; a plain resolver receives duplicates.
- The `References` module documentation mentions concurrency, but there is no current-concurrency reference.

## Surprising behaviour

- **JSON Schema generation** drops `isPattern` checks, and turns `isMinLength(n)` into `minLength: ceil(n / 2)` (a deliberate UTF-16 approximation).
- **`ByteSize.format`** uses binary units by default: 25 MB prints as `23.84 MiB` unless you pass `{ system: 'decimal' }`.
- **`Schema.NumberFromString`** decodes `"abc"` to `NaN`. Use `Schema.FiniteFromString` to reject it.
- **NDJSON and `ChannelSchema`** decode a batch at once, so one bad line fails every value in its batch.
- **SSE**: a `retry:` directive arrives as a `Retry` failure on the stream, not as an event.
- **`Stream.retry`** reruns the whole stream, so values emitted before the failure appear again.
- **`Equal.equals`** compares plain objects, arrays, Maps and Dates by contents. Hashes are cached per object, so mutating a `HashMap` key after inserting it makes the entry unfindable.
- **`Option` and `Result`** can no longer be `yield*`-ed inside `Effect.gen`; use `Effect.fromOption` and `Effect.fromResult`.
- **`Cause`** is a flat list of reasons; there is no sequential or parallel tree.
- **`Effect.fork`** is gone: use `forkChild`, `forkDetach`, `forkScoped` or `forkIn`. Transactions run with `Effect.tx`.
- **Semaphore permits are not reentrant**: nesting `withPermits` on a fiber that already holds a permit deadlocks.
- **`Template`** (HTTP) does no HTML escaping.
- **`Model.GeneratedByDb`** leaves the field out of the `update` variant, so it cannot be the id column of `SqlModel.makeRepository`.
- **SQLite error reasons**: a duplicate primary key is a `ConstraintError`; a duplicate UNIQUE column is a `UniqueViolation`.
- **`HttpApi` payloads**: a plain field record is sent as a URL-encoded form; JSON needs `Schema.Struct`. Invalid input gets an empty 400.
- **`HttpApiScalar.layer`** adds about 3.2 MB to a bundle and `HttpApiSwagger.layer` about 2 MB. Scalar has a CDN variant; Swagger does not.
- **The default logger** prints timestamps and fiber IDs, and the metric registry is global, so deterministic programs must install their own logger and metric registry.
- **`ClusterMetrics`** gauges always write to the global registry.
- **Reactivity**: an atom with no subscriber and no `mount` is disposed on the next tick, interrupting its effect.
- **`TestCrypto`**'s seeded generator starts when the layer value is created, so reusing one layer value continues the sequence.
- **Event log compaction** changes only what handlers see. The memory and SQL journals still store every original remote entry.
- **`EventLog.layerEventLog`** builds its own `Reactivity` and does not expose it. A program sees the same instance `groupReactivity` invalidates only by merging `Reactivity.layer` into the same layer build.
- **`EventJournal.EntryId` and `RemoteId`** schemas accept a `Uint8Array` of any length.
- **`EventGroup.isEventGroup`** narrows to `EventGroup.Any`, a marker type without `.events`.
- **`EventJournal` method `withRemoteUncommited`** is spelled with one "t".
- **`EventLogRemote`** retries only `Forbidden` replies (re-authenticating up to five times), and logs refused writes at debug level. Sync server sequence numbers start at 0.
- **RPC client ids** come from one counter shared by every client in the process, so a custom transport must reply to the id it was sent, not assume 0.
- **`SqlEventLogServerUnencrypted.makeStorage`** names its options `_options` in the declaration but does read them.
- **Drivers**: `@effect/sql-sqlite-wasm` works in Bun but not in Node (it loads its `.wasm` with `fetch` on a `file://` URL). `@effect/sql-sqlite-node` works in Node but not in Bun on macOS (SQLite there lacks extension loading).
