import { createServer } from 'node:net'
import { resolve } from 'node:path'
import { setTimeout as pause } from 'node:timers/promises'

import { Schema } from 'effect'

import manifest from '../package.json' with { type: 'json' }

export type HostMode = 'development' | 'production'
export type Host = { readonly url: string }
const root = resolve(import.meta.dirname, '..')
export const cloudflare = manifest.hvs.starter.preset === 'cloudflare-app'
const ProcessRow = Schema.Struct({
  pid: Schema.Int,
  parent: Schema.Int,
  group: Schema.Int,
})
const deadline = <A>(promise: Promise<A>, milliseconds: number): Promise<A> => {
  let timer: ReturnType<typeof setTimeout> | undefined
  return Promise.race([
    promise,
    new Promise<never>((_resolve, reject) => {
      timer = setTimeout(
        () => reject(new Error('Process deadline exceeded')),
        milliseconds,
      )
    }),
  ]).finally(() => clearTimeout(timer))
}
const signalGroup = (
  group: number,
  signal: 'SIGTERM' | 'SIGKILL' | 0,
): boolean => {
  try {
    process.kill(-group, signal)
    return true
  } catch (error) {
    if (error instanceof Error && 'code' in error && error.code === 'ESRCH') {
      return false
    }
    if (
      signal === 0 &&
      error instanceof Error &&
      'code' in error &&
      error.code === 'EPERM'
    ) {
      return true
    }
    throw error
  }
}
const collectGroups = async (
  pid: number,
  groups: Set<number>,
): Promise<void> => {
  const census = Bun.spawn(['ps', '-axo', 'pid=,ppid=,pgid='], {
    stdout: 'pipe',
    stderr: 'ignore',
  })
  try {
    const output = await deadline(new Response(census.stdout).text(), 1000)
    if ((await deadline(census.exited, 1000)) !== 0) {
      throw new Error('Process census failed')
    }
    const rows = output
      .trim()
      .split('\n')
      .map((line) => {
        const [rowPid, parent, group] = line.trim().split(/\s+/u).map(Number)
        return Schema.decodeUnknownSync(ProcessRow)({
          pid: rowPid,
          parent,
          group,
        })
      })
    const descendants = new Set([pid])
    let previousSize = -1
    while (descendants.size !== previousSize) {
      previousSize = descendants.size
      for (const row of rows) {
        if (descendants.has(row.parent) || groups.has(row.group)) {
          descendants.add(row.pid)
          if (row.group > 1 && row.group !== process.pid) {
            groups.add(row.group)
          }
        }
      }
    }
  } finally {
    census.kill('SIGKILL')
    await deadline(census.exited, 1000)
  }
}
const stopProcess = async (
  child: Pick<Bun.Subprocess, 'pid' | 'exited'>,
  groups: Set<number>,
): Promise<void> => {
  const failures: unknown[] = []
  try {
    await collectGroups(child.pid, groups)
  } catch (error) {
    failures.push(error)
  }
  for (const group of groups) {
    try {
      signalGroup(group, 'SIGTERM')
    } catch (error) {
      failures.push(error)
    }
  }
  const termEnd = Date.now() + 1000
  while (
    [...groups].some((group) => signalGroup(group, 0)) &&
    Date.now() < termEnd
  ) {
    await Bun.sleep(25)
  }
  for (const group of groups) {
    try {
      signalGroup(group, 'SIGKILL')
    } catch (error) {
      failures.push(error)
    }
  }
  await deadline(child.exited, 5000)
  const killEnd = Date.now() + 5000
  while (
    [...groups].some((group) => signalGroup(group, 0)) &&
    Date.now() < killEnd
  ) {
    await Bun.sleep(25)
  }
  if ([...groups].some((group) => signalGroup(group, 0))) {
    failures.push(new Error('Owned process group survived SIGKILL'))
  }
  if (failures.length > 0) {
    throw new AggregateError(failures, 'Process cleanup failed')
  }
}
export async function availablePort(): Promise<number> {
  const server = createServer()
  await new Promise<void>((accept, reject) => {
    server.once('error', reject)
    server.listen(0, '127.0.0.1', accept)
  })
  const address = server.address()
  await new Promise<void>((accept, reject) =>
    server.close((error) => (error ? reject(error) : accept())),
  )
  if (!address || typeof address === 'string') {
    throw new Error('No local port allocated')
  }
  return address.port
}
export async function withHost<A>(
  mode: HostMode,
  use: (host: Host) => Promise<A>,
): Promise<A> {
  const port = await availablePort()
  const stage = `verify-${process.pid}-${port}`
  const args =
    mode === 'production'
      ? ['run', 'scripts/production.ts']
      : cloudflare
        ? ['run', '--cwd', 'apps/deploy', 'dev', '--no-input', '--stage', stage]
        : [
            'run',
            '--cwd',
            'apps/web',
            'dev',
            '--host',
            '127.0.0.1',
            '--port',
            String(port),
            '--strictPort',
          ]
  const child = Bun.spawn([process.execPath, ...args], {
    cwd: root,
    detached: true,
    stdin: 'ignore',
    stdout: 'pipe',
    stderr: 'pipe',
    env: { ...process.env, PORT: String(port), NO_COLOR: '1', PORTLESS: '0' },
  })
  const interrupted = new AbortController()
  const onTerm = () =>
    interrupted.abort(new Error('Host interrupted by SIGTERM'))
  const onInt = () => interrupted.abort(new Error('Host interrupted by SIGINT'))
  process.on('SIGTERM', onTerm)
  process.on('SIGINT', onInt)
  const cancelled = new Promise<never>((_resolve, reject) => {
    interrupted.signal.addEventListener(
      'abort',
      () => reject(interrupted.signal.reason),
      { once: true },
    )
  })
  const groups = new Set([child.pid])
  const monitoring = new AbortController()
  const monitor = (async () => {
    while (!monitoring.signal.aborted) {
      await collectGroups(child.pid, groups)
      await Bun.sleep(100)
    }
  })().catch((error) => interrupted.abort(error))
  let logs = ''
  const drain = async (stream: ReadableStream<Uint8Array>) => {
    for await (const value of stream) {
      logs = (logs + new TextDecoder().decode(value)).slice(-65_536)
    }
  }
  const drains = Promise.all([drain(child.stdout), drain(child.stderr)])
  void drains.catch((error) => interrupted.abort(error))
  let outcome:
    | { kind: 'success'; value: A }
    | { kind: 'failure'; error: unknown }
  try {
    const value = await Promise.race([
      (async () => {
        const url = `http://127.0.0.1:${port}`
        const end = Date.now() + 120_000
        let ready = false
        while (!ready && Date.now() < end) {
          interrupted.signal.throwIfAborted()
          if (child.exitCode !== null) {
            throw new Error(`Host exited during startup\n${logs}`)
          }
          try {
            ready = (
              await fetch(`${url}${cloudflare ? '/api/health' : '/'}`, {
                signal: AbortSignal.any([
                  interrupted.signal,
                  AbortSignal.timeout(3000),
                ]),
              })
            ).ok
          } catch {
            ready = false
          }
          if (!ready) {
            await pause(150)
          }
        }
        if (!ready) {
          throw new Error(`Host did not become ready\n${logs}`)
        }
        return await use({ url })
      })(),
      cancelled,
    ])
    outcome = { kind: 'success', value }
  } catch (error) {
    outcome = {
      kind: 'failure',
      error: new Error(`Host ${mode} failed\n${logs}`, { cause: error }),
    }
  }
  try {
    monitoring.abort()
    await monitor
    await stopProcess(child, groups)
    await deadline(drains, 5000)
  } catch (error) {
    throw new AggregateError(
      outcome.kind === 'failure' ? [outcome.error, error] : [error],
      'Host cleanup failed',
    )
  } finally {
    process.off('SIGTERM', onTerm)
    process.off('SIGINT', onInt)
  }
  if (outcome.kind === 'failure') {
    throw outcome.error
  }
  interrupted.signal.throwIfAborted()
  return outcome.value
}
