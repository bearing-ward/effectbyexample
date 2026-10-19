import * as Alchemy from 'alchemy'
import * as Cloudflare from 'alchemy/Cloudflare'
import { Config, Effect, Layer, Option } from 'effect'

import { projectName } from '../../scripts/project.ts'

const state = Layer.unwrap(
  Effect.gen(function* () {
    const dev = yield* Alchemy.ALCHEMY_DEV.pipe(Effect.orDie)
    return dev ? Alchemy.localState() : Cloudflare.state()
  }),
)
export default Alchemy.Stack(
  'EffectByExample',
  { providers: Cloudflare.providers(), state },
  Effect.gen(function* () {
    const port = yield* Config.Number('PORT').pipe(Config.option)
    const site = yield* Cloudflare.Website.Foldkit('Website', {
      name: projectName,
      rootDir: new URL('../web', import.meta.url).pathname,
      main: '../api/src/worker.ts',
      assets: { runWorkerFirst: ['/api/*'] },
      ...Option.match(port, {
        onNone: () => ({}),
        onSome: (value) => ({ dev: { port: value, strictPort: true } }),
      }),
    })
    return { url: site.url }
  }),
)
