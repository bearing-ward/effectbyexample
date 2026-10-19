# Authoring examples

Effect by Example teaches Effect to people who find the reference docs hard to get into. Each example is one small, real program that shows one idea. A reader should finish a page knowing what the API is for, when to reach for it, and what it does at runtime.

## File format

An example is `packages/examples/src/<category>/<slug>.ts`. Name it `<slug>.server.ts` when it needs Node or Bun APIs (files, processes, sockets, `node:sqlite`). Server examples are not bundled into the site; their pages show the output recorded by the tests.

```ts
/**
 * @title Defining a schema
 * @difficulty beginner
 * @summary One to three sentences: what this is and why you would use it.
 */

// Every `//` comment line, indented or not, becomes prose in the left column.
// The code after it, up to the next comment, goes in the right column.
import { Console, Effect, Schema } from 'effect'

export const program = Effect.gen(function* () {
  // Narrate inside the program too. Each comment starts a new segment.
  yield* Console.log('hello')
})
```

- `@difficulty` is `beginner`, `intermediate`, or `advanced`.
- Export exactly one runnable `program: Effect.Effect<void, unknown, never>`. Provide every service and layer inside it, and close scopes with `Effect.scoped`.
- Print with `Console.log`, never `console.log`. The site and the tests capture `Console`.
- Use `/* */` for a comment that should stay inside the code.

## Writing

- Write for a reader learning Effect, not for maintainers. Explain why, not only what.
- One idea per example, roughly 30 to 90 lines. Several small examples beat one long one.
- Realistic domains (orders, users, todos), not `foo` and `bar`.
- Plain, direct sentences. No marketing words, no "simply" or "just", no em dashes.
- Use the idioms in `node_modules/effect/CLAUDE.md`: `Effect.gen`, `Schema.TaggedError` for errors, services with `Context.Service`, layers.
- Mention a module's stability when Effect marks it `@stability unstable`.

## Correctness

- This is Effect **4.0.5**. Check every API against `node_modules/effect/dist/**/*.d.ts` and the source in `node_modules/effect/src`. Effect 3 APIs and names often differ (for example `Context.Service`, `Effect.catch`, `Schema.TaggedError`, `Array.filterMap` takes a `Result`). Never write from memory.
- Every claim in the prose must be true and shown by the program where possible. If you are unsure, test it.
- Output must be deterministic: no timestamps, random IDs, execution IDs, fiber IDs, file paths from temp directories, or timing-dependent ordering. Wait for observable state (`Effect.repeat({ until })`) instead of sleeping and hoping.
- Programs must finish within a few seconds and must not touch the network. Use in-memory layers, test clients, `layerTest`, `RpcTest`, `HttpApiTest`, fake providers, and so on.
- Browser examples must run in a browser: no `node:` imports and nothing from `@effect/platform-node`.

## Coverage

Each category owns a list of modules in `packages/examples/src/catalog.ts` (`modules`). Across your examples, import every module in your categories' lists by name from `effect` or its subpath, for example `import { HttpClient } from 'effect/http'`. `bun run content:status --offline` reports what is still uncovered.

Subpaths listed in `exhaustiveSubpaths` in `catalog.ts` (today `effect/eventlog`) are covered export by export. Every exported value of every module under them must appear in some example as `Module.name`, used for what it is for. `content:status` lists the missing ones, and `content:check` fails until each is used or exempted in `exemptExports` with a reason.

If a module truly cannot be demonstrated in a runnable program (it needs real infrastructure, or it is plumbing for library authors), do not fake it. Report it with a one-line reason, and the maintainer decides whether to exempt it.

## Commands

```sh
bun run examples:run <category>/<slug> [--segments]   # run and print, optionally with prose segments
bunx tsc --noEmit -p packages/examples/tsconfig.json         # browser examples
bunx tsc --noEmit -p packages/examples/tsconfig.server.json  # .server.ts examples
bunx oxfmt --write packages/examples/src/<category>          # format your files
```

Run each example several times to make sure its output does not change.

## Boundaries for parallel authors

- Only create files under your own category directories (and `.cache/<your-name>/` for scratch work).
- Do not edit `catalog.ts`, `outputs.json`, `content-log.json`, `package.json`, the site, or another category's files. Report what you need instead.
- If you need a dependency that is not installed, report it with the exact package and version rather than installing it.
