# Project instructions

Use `bun install --frozen-lockfile` and `bun run verify`. Internal workspace names stay generic. Root `hvs.project.localName` owns local identity. Compiler programs belong in each manifest's `hvs.checks.projects`. A new workspace needs its own manifest, compiler configuration, and tests.

Keep neutral core free of host globals. Put browser code in `apps/web`, Worker code in `apps/api`, and Alchemy imports in `apps/deploy` when those apps exist. Read local README commands before running hosts. Do not deploy without user authorization. Read `FOLDKIT.md` before changing the Foldkit app. The app's Model, Messages, update, and view live in `main.ts`. A self-contained part such as `sidebar.ts` may be a Submodel in its own file. `entry.ts` alone boots the runtime.

## Examples

Follow [docs/authoring-examples.md](docs/authoring-examples.md). Each example is `packages/examples/src/<category>/<slug>.ts` (or `<slug>.server.ts` when it needs Node). It has a `/** @title @difficulty @summary */` header, then an exported `program` that prints with `Console`. Every `//` line becomes prose, so write for a reader learning Effect. List slugs in `src/catalog.ts`; programs are discovered from the files. `bun run examples:outputs` records every program's output in `packages/examples/outputs.json`, and `examples.test.ts` fails when the output changes. Read the diff of `outputs.json` to confirm each output teaches what its prose claims. Check API names against `node_modules/effect/dist/**/*.d.ts` (Effect 4), not against memory of Effect 3.

Every exported Effect module belongs to one category's `modules` list. `content:status` reports modules that no example imports yet. A new Effect release that adds modules shows up there as unassigned. Subpaths in `exhaustiveSubpaths` (today `eventlog`) are covered export by export: every exported value must be read by an example as `Module.name`, unless `exemptExports` lists it with a reason. `content:check` fails while one is missing.

## Content log

After adding, editing, or deleting an example, run `bun run content:log --note "..."`; `verify:fast` fails until the log matches the sources. When an example is reread and still accurate without edits, record it with `bun run content:review <category/slug>`. Only record a review after actually rereading the prose against the installed Effect API.

When starting a session on this project, run `bun run content:status` and tell the user what needs attention before other work. That covers unlogged changes, examples checked against an older Effect, stale reviews, a newer Effect release, and empty planned categories.

## Effect version

Every Effect release-train package (`effect`, `@effect/platform-*`, `@effect/sql-*`) resolves to one exact version. Today that is 4.0.5. Bump it in every workspace manifest and in root `overrides`. Foldkit pins its `@effect/platform-browser` peer exactly, and Bun overrides don't rewrite peers, so root `resolutions` also pins that package. After `bun install`, confirm `bun.lock` lists only one version of each train package. The site reads its version label from `packages/examples/package.json`.

Foldkit 0.165–0.168 declares `effect: 4.0.0`. effect 4.0.5 turned `Crypto.randomUUIDv4`/`randomUUIDv7` into methods, which silently broke the Vite plugin's DevTools MCP relay. `patches/@foldkit%2Fvite-plugin@0.26.0.patch` carries that one-line fix. Drop it once Foldkit supports the new API. Patch-level Effect releases can break dependents, so run the full `bun run verify` after every bump, then `content:review` the examples.
