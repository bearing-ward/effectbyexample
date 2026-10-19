/**
 * @title Redis commands and scripts
 * @difficulty advanced
 * @summary The `Redis` service is the small interface the Redis-backed
 * persistence layers need: send a command, subscribe to a channel, and run a
 * Lua script. Scripts are loaded once and then called by their hash.
 */

import { Console, Effect } from 'effect'
import { Redis } from 'effect/persistence'

// `Redis.script` describes a Lua script. The function maps typed arguments to
// the script's keys and arguments, and `numberOfKeys` says how many of them
// are keys. This one adds to a counter and returns the new value.
const incrementBy = Redis.script(
  (key: string, amount: number) => [key, amount],
  {
    lua: "return redis.call('INCRBY', KEYS[1], ARGV[1])",
    numberOfKeys: 1,
  },
).withReturnType<number>()

export const program = Effect.gen(function* () {
  // A real application provides `Redis` with `NodeRedis.layer` from
  // `@effect/platform-node`, which needs a Redis server. To run here, this
  // stand-in client records every command and answers the few it needs.
  // `flushScripts` makes it forget loaded scripts, like a restarted server.
  const sent: Array<string> = []
  const counters = new Map<string, number>()
  let scriptLoaded = false
  const flushScripts = Effect.sync(() => {
    scriptLoaded = false
  })

  const redis = yield* Redis.make({
    send: <A>(command: string, ...args: ReadonlyArray<string>) =>
      Effect.suspend(() => {
        sent.push([command, ...args].join(' '))
        if (command === 'SCRIPT') {
          scriptLoaded = true
          return Effect.succeed('sha-1' as A)
        }
        if (command === 'EVALSHA' && !scriptLoaded) {
          return Effect.fail(new Redis.RedisError({ cause: 'NOSCRIPT' }))
        }
        if (command === 'EVALSHA') {
          const [, , key = '', amount = '0'] = args
          const next = (counters.get(key) ?? 0) + Number(amount)
          counters.set(key, next)
          return Effect.succeed(next as A)
        }
        return Effect.succeed('OK' as A)
      }),
    subscribe: () => Effect.succeed(Effect.never),
  })

  // `send` runs any command.
  yield* redis.send('SET', 'greeting', 'hello')

  // `eval` returns a typed function for the script. The first call loads the
  // script with `SCRIPT LOAD`; later calls only send `EVALSHA` with the hash.
  const increment = redis.eval(incrementBy)
  yield* Console.log(yield* increment('page-views', 5))
  yield* Console.log(yield* increment('page-views', 2))

  // If the server has forgotten the script, the `NOSCRIPT` error makes the
  // client load it again and retry, without the caller noticing.
  yield* flushScripts
  yield* Console.log(yield* increment('page-views', 1))

  // The full conversation. `Persistence.layerRedis`,
  // `PersistedQueue.layerStoreRedis`, and `RateLimiter.layerStoreRedis` talk
  // to Redis through this same service, mostly with scripts like this one.
  yield* Console.log(sent)
})
