<img src="assets/icon.svg" width="64" height="64" alt="">

# Effect by Example

Short, annotated [Effect](https://effect.website) programs, one idea at a time, in the spirit of [Deno by Example](https://docs.deno.com/examples/). Each page puts notes on the left and code on the right, and its **Run** button runs the program in your browser and shows what it prints.

Every example is a real TypeScript file. It is type-checked, and its output is snapshot-tested against the `effect` version pinned in `packages/examples/package.json` (currently 4.0.5). The site reads its version label from that pin. An example can't drift from the API without CI noticing.

Built on the cafe stack (Cloudflare, Alchemy, Foldkit, Effect) with [Foldworks](https://foldworks.dev) UI. Adopted from HVS Template through the OpenLayers Sandbox `cloudflare-app` starter (see `PROVENANCE.json`).

## What's here

284 examples in 28 categories. Together they demonstrate every module `effect` exports, and every exported value of `effect/eventlog`: `bun run content:status` checks this against the installed package.

- **Effect basics** (8): Effects as values, generators, pipe, and running programs.
- **Error handling** (8): Typed failures, defects, causes, and recovering on purpose.
- **Data types** (12): Option, Result, structural equality, pattern matching, and brands.
- **Collections** (10): Immutable and mutable collections with the operations you reach for daily.
- **Schema** (14): Describe your data once, then validate it, transform it, and derive types from it.
- **Schema in depth** (11): The schema AST, parsers, issues, Standard Schema, models, and compilers.
- **Services and layers** (10): Dependency injection without a framework: services, layers, and configuration.
- **Resources** (8): Acquire and release safely with scopes, pools, reference counting, and caches.
- **Concurrency** (13): Fibers, racing, interruption, and the primitives that coordinate them.
- **Time and scheduling** (8): Durations, dates, cron, retries, repeats, and fallbacks.
- **Streams** (8): Pull-based streams, sinks, and the channels underneath them.
- **Transactions** (8): Software transactional memory: compose updates that commit together or retry.
- **Batching and caching requests** (3): Turn many lookups into one call, and deduplicate the rest.
- **Observability** (10): Logs, spans, metrics, and exporting them.
- **Testing** (7): Control time, capture output, and generate test data.
- **Encoding** (7): YAML, TOML, INI, hex, NDJSON, server-sent events, JSON Patch, and JSON Pointer.
- **Workflows** (8), unstable: Durable, long-running processes that survive restarts: activities, signals, sleeps, and compensation.
- **Event log** (9), unstable: Record what happened as typed events, derive state from them, and sync them between devices.
- **HTTP** (11), unstable: HTTP clients and servers built from Effect values.
- **HttpApi** (7), unstable: Schema-first HTTP APIs with typed clients and OpenAPI documents.
- **RPC** (8), unstable: Typed remote procedure calls over any transport, including streaming.
- **GraphQL** (7), unstable: Typed GraphQL operations, clients, middleware, and batching.
- **SQL** (9), unstable: Type-safe queries, models, resolvers, and migrations.
- **Persistence** (6), unstable: Key-value stores, persisted caches and queues, and rate limiting.
- **Platform** (12), unstable: Files, paths, terminals, processes, sockets, workers, and networking.
- **CLI** (8), unstable: Command-line apps with typed arguments, flags, help, and prompts.
- **AI** (10), unstable: Provider-agnostic language models, tools, chat, and MCP servers.
- **Cluster** (15), unstable: Distributed entities, singletons, and cron jobs across many machines.
- **Reactivity** (8), unstable: Atoms: reactive state for user interfaces, with async results and invalidation.

Categories marked unstable cover modules Effect marks `@stability unstable` (or experimental), and the site badges those pages. Examples run against in-memory engines, servers, clients and fakes, so most run in your browser. Examples that need Node (files, processes, sockets, `node:sqlite`) show the output recorded by the tests instead.

## Run it

```sh
bun install --frozen-lockfile
bun run foldkit:source   # pinned Foldkit source in repos/foldkit, for reference
bun run dev
```

`bun run dev` serves the site through [Portless](https://github.com/vercel-labs/portless) at `https://effectbyexample.localhost`. The first time, Portless needs its HTTPS proxy on port 443, which prompts for your password, so start it once from a terminal:

```sh
sudo bunx portless proxy start --https
```

Use `bun run dev:direct` (or `PORTLESS=0 bun run dev`) to skip the proxy and serve on `http://localhost:4321`.

## Add an example

1. Create `packages/examples/src/<category>/<slug>.ts` with a header, then the program:

   ```ts
   /**
    * @title Defining a schema
    * @difficulty beginner
    * @summary One or two sentences for the index card and page lede.
    */

   // Every `//` comment line, indented or not, becomes prose on the left.
   // The code after it, up to the next comment, goes on the right.
   import { Console, Effect, Schema } from 'effect'

   export const program = Effect.gen(function* () {
     // Print with `Console`, so the page and the tests can capture output.
     yield* Console.log('hello')
   })
   ```

   Name it `<slug>.server.ts` instead when it needs Node or Bun APIs. Server examples stay out of the browser bundle, and their pages show recorded output instead of a Run button.

2. Add the slug to its category's `slugs` in `packages/examples/src/catalog.ts`, in reading order. A category is published once it has slugs.
3. Run `bun run examples:run <category>/<slug> --segments` to read the prose next to the output while you write.
4. Run `bun run examples:outputs` to record its output in `packages/examples/outputs.json`, then read the diff to confirm the output teaches what the prose claims.
5. Run `bun run content:log --note "what changed"` to record it in the content log.
6. Run `bun run verify:fast`. It fails if a file is missing from the catalog, or the catalog lists a missing file. It also fails if a program fails or its output differs from `outputs.json`.

The full authoring rules (tone, determinism, verifying against Effect 4 types) are in [docs/authoring-examples.md](docs/authoring-examples.md).

## Content log

`packages/examples/content-log.json` is an append-only history of every example. Each entry records when the example was added, modified, reviewed, or removed, a hash of its source, and the Effect version it was checked against. Pages show the dates as "Added · Updated · Checked against effect X".

```sh
bun run content:status                      # table of dates plus anything needing attention
bun run content:log --note "..."            # record added, modified, and removed examples
bun run content:review schema/checks        # reread and still accurate: record a review
bun run content:review --all --note "4.1"   # after an Effect upgrade, once prose is checked
```

`content:status` flags these:

- source changes that were never logged
- examples last checked against an older Effect than the installed one
- examples not reviewed in 180 days (`--stale-days N`)
- a newer `effect` release on npm (skip the check with `--offline`)
- planned categories that still have no examples
- exported Effect modules that no example demonstrates yet, grouped by the category that owns them (`exemptModules` in `catalog.ts` lists the few type-level modules that don't need one)
- for `effect/eventlog`, which is covered export by export, any exported value no example uses (`content:check` fails on these too)

`verify:fast` fails while the log is out of sync with the sources.

`@difficulty` is `beginner`, `intermediate`, or `advanced`. Use `/* */` for a comment that should stay inside the code.

## Layout

```text
packages/
  examples/   example sources, Deno-style parser, console-capturing runner, catalog (neutral, no host globals)
apps/
  web/        Foldkit site with Foldworks UI; reads example sources as raw text and runs their programs
              sidebar.ts: filter (Cmd/Ctrl+K), collapsible categories, arrow-key navigation
  api/        Cloudflare Worker: /api/health, JSON 404 for other /api routes, then static assets
  deploy/     Alchemy stack: Worker plus Foldkit website
```

## Verify

```sh
bun run verify:fast         # types, Effect diagnostics, format, lint, tests
bun run verify:template     # HVS compiler-ownership checks, Foldkit source pin
bun run browser:install     # once
bun run verify:integration  # real alchemy dev host, browser run, DevTools MCP
bun run verify:production   # built Worker and assets in Miniflare
bun run verify              # everything
```

## Deploy

`bun run deploy` needs Cloudflare credentials and your explicit go-ahead. After the first deploy, the stack key (`EffectByExample`) and resource key (`Website`) are durable identities.

### GitHub Pages

The site is static, so it also runs on GitHub Pages. `.github/workflows/pages.yml` builds and publishes it on every push to `main`. To turn it on, set Settings → Pages → Source to "GitHub Actions".

Pages serves the site below `/<repository>/`. `bun run build:pages` builds with Vite's `base` set from `PAGES_BASE` (default `/effectbyexample/`; the workflow passes the real path). It also writes an HTML copy for every example, so deep links return 200, and a `404.html` that boots the app for any other path. `bun run verify:pages` serves that build the way Pages does and checks it in a browser; `bun run verify` includes it. The Worker's `/api/health` is not part of the Pages site, and the site doesn't use it.
