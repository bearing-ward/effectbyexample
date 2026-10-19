import { mkdir, lstat, rename, rm } from 'node:fs/promises'
import { resolve } from 'node:path'

import { Schema } from 'effect'

import pin from '../foldkit-source.json' with { type: 'json' }
import { run } from './checks.ts'

const FoldkitManifest = Schema.Struct({
  dependencies: Schema.Struct({ foldkit: Schema.String }),
})
const root = resolve(import.meta.dirname, '..')
export async function checkSourcePin(): Promise<void> {
  const manifest = Schema.decodeUnknownSync(FoldkitManifest)(
    await Bun.file(resolve(root, 'apps/web/package.json')).json(),
  )
  if (
    manifest.dependencies.foldkit !== pin.version ||
    !/^[a-f0-9]{40}$/u.test(pin.commit)
  ) {
    throw new Error('Foldkit release and source pin disagree.')
  }
  const installed = Schema.decodeUnknownSync(
    Schema.Struct({ version: Schema.String }),
  )(
    await Bun.file(
      resolve(root, 'apps/web/node_modules/foldkit/package.json'),
    ).json(),
  )
  if (installed.version !== pin.version) {
    throw new Error('Installed Foldkit differs from the source pin.')
  }
  console.log(`PASS Foldkit source pin ${pin.version} ${pin.commit}`)
}
if (import.meta.main) {
  await checkSourcePin()
  const destination = resolve(root, 'repos/foldkit')
  try {
    await lstat(destination)
    throw new Error(
      'repos/foldkit already exists. Preserve it and reconcile its source pin manually.',
    )
  } catch (error) {
    if (
      !(error instanceof Error && 'code' in error && error.code === 'ENOENT')
    ) {
      throw error
    }
  }
  const stage = resolve(root, '.cache', `foldkit-source-${process.pid}`)
  await mkdir(stage, { recursive: true })
  try {
    const response = await fetch(
      `https://codeload.github.com/foldkit/foldkit/tar.gz/${pin.commit}`,
      { signal: AbortSignal.timeout(60_000) },
    )
    if (!response.ok) {
      throw new Error(`Foldkit download failed: ${response.status}`)
    }
    await Bun.write(resolve(stage, 'source.tar.gz'), response)
    await mkdir(resolve(stage, 'source'))
    await run([
      'tar',
      '-xzf',
      resolve(stage, 'source.tar.gz'),
      '--strip-components=1',
      '-C',
      resolve(stage, 'source'),
    ])
    await mkdir(resolve(root, 'repos'), { recursive: true })
    await rename(resolve(stage, 'source'), destination)
    console.log(`Foldkit source ready at ${destination}`)
  } finally {
    await rm(stage, { recursive: true, force: true })
  }
}
