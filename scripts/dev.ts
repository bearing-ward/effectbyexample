import { spawn } from 'node:child_process'

import { cloudflare } from './host.ts'
import { projectName } from './project.ts'

// Portless serves the app at https://<hvs.project.localName>.localhost (linked
// worktrees get a branch prefix). Set PORTLESS=0 for a plain local port.
const direct = process.env.PORTLESS === '0'
const host = cloudflare
  ? ['run', '--cwd', 'apps/deploy', 'dev']
  : ['run', '--cwd', 'apps/web', 'dev']
const [command, ...args] = direct
  ? [process.execPath, ...host]
  : ['portless', 'run', '--name', projectName, process.execPath, ...host]

console.log(
  direct
    ? `Starting ${projectName}; open the host URL printed below.`
    : `Starting ${projectName} at https://${projectName}.localhost`,
)
const child = spawn(command ?? process.execPath, args, {
  stdio: 'inherit',
  env: direct
    ? { ...process.env, PORTLESS: '0', PORT: process.env.PORT ?? '4321' }
    : process.env,
})
process.on('SIGINT', () => child.kill('SIGINT'))
process.on('SIGTERM', () => child.kill('SIGTERM'))
child.once('exit', (code) => process.exit(code ?? 1))
