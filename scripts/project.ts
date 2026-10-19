import { Schema } from 'effect'

import manifest from '../package.json' with { type: 'json' }

const Identity = Schema.Struct({
  localName: Schema.String.check(
    Schema.isPattern(/^[a-z][a-z0-9]*(?:-[a-z0-9]+)*$/u),
  ),
})
export const projectName = Schema.decodeUnknownSync(Identity)(
  manifest.hvs.project,
).localName
