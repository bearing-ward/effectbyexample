import manifest from '../package.json' with { type: 'json' }

/** The Effect release every example is written, run, and tested against. */
export const effectVersion = manifest.dependencies.effect
