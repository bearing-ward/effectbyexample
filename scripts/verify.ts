import { checkTemplate, checkTypes, run } from './checks.ts'

const tiers = ['fast', 'integration', 'template', 'production', 'all', 'types']
const tier = process.argv[2] ?? 'all'
if (!tiers.includes(tier)) {
  throw new Error(`Unknown verification tier: ${tier}`)
}
if (['fast', 'all', 'types'].includes(tier)) {
  await checkTypes()
}
if (['fast', 'all'].includes(tier)) {
  console.log(
    (await run(['bun', 'x', '--no-install', 'oxfmt', '--check', '.'])).stdout,
  )
  const lint = await run([
    'bun',
    'x',
    '--no-install',
    'oxlint',
    'scripts',
    'packages',
    'apps',
  ])
  console.log(lint.stdout)
  console.log((await run(['bun', 'run', 'scripts/content.ts', 'check'])).stdout)
  const tests = await run(['bun', 'x', '--no-install', 'vitest', 'run'])
  console.log(tests.stdout)
}
if (['template', 'all'].includes(tier)) {
  await checkTemplate()
}
if (['template', 'all'].includes(tier)) {
  const { checkSourcePin } = await import('./foldkit-source.ts')
  await checkSourcePin()
}
if (['integration', 'production', 'all'].includes(tier)) {
  const { verifyBrowser } = await import('./browser.ts')
  if (['integration', 'all'].includes(tier)) {
    await verifyBrowser('development')
  }
  if (['production', 'all'].includes(tier)) {
    // Before the production check, which rebuilds dist without a base path.
    const { verifyPages } = await import('./pages.ts')
    await verifyPages()
    await verifyBrowser('production')
  }
}
console.log(`PASS verify:${tier}`)
