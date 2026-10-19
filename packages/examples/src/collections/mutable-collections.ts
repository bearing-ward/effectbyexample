/**
 * @title Mutable collections
 * @difficulty intermediate
 * @summary `MutableHashMap`, `MutableHashSet`, and `MutableList` change in
 * place. Use them for state that one piece of code owns and updates many
 * times, such as tallies inside a loop or a work queue, where keeping old
 * versions would only cost allocations.
 */

import {
  Console,
  Effect,
  MutableHashMap,
  MutableHashSet,
  MutableList,
  Option,
} from 'effect'

interface PageView {
  readonly user: string
  readonly page: { readonly path: string; readonly locale: string }
}

const views: ReadonlyArray<PageView> = [
  { user: 'ada', page: { path: '/pricing', locale: 'en' } },
  { user: 'grace', page: { path: '/pricing', locale: 'en' } },
  { user: 'ada', page: { path: '/pricing', locale: 'en' } },
  { user: 'alan', page: { path: '/pricing', locale: 'fr' } },
  { user: 'grace', page: { path: '/docs', locale: 'en' } },
]

export const program = Effect.gen(function* () {
  // `MutableHashMap` uses the same structural keys as `HashMap`, so the
  // page object works as a key. `modifyAt` updates the entry in place and
  // returns the same map.
  const hits = MutableHashMap.empty<PageView['page'], number>()

  // `MutableHashSet` records which user and page pairs we have seen, so we
  // can also count unique visitors.
  const seen = MutableHashSet.empty<readonly [string, string, string]>()

  for (const view of views) {
    MutableHashMap.modifyAt(hits, view.page, (count) =>
      Option.some(Option.getOrElse(count, () => 0) + 1),
    )
    MutableHashSet.add(seen, [view.user, view.page.path, view.page.locale])
  }

  yield* Console.log(
    MutableHashMap.get(hits, { path: '/pricing', locale: 'en' }),
  )
  yield* Console.log(`pages: ${MutableHashMap.size(hits)}`)
  yield* Console.log(`unique visits: ${MutableHashSet.size(seen)}`)

  // `MutableList` is a linked list with cheap appends at the end and takes
  // from the front, which makes it a good first-in, first-out queue.
  const jobs = MutableList.make<string>()
  MutableList.append(jobs, 'resize avatar')
  MutableList.append(jobs, 'send receipt')
  MutableList.append(jobs, 'rebuild index')

  // `prepend` jumps the queue.
  MutableList.prepend(jobs, 'refund order')

  // `take` removes one element. When the list is empty it returns the
  // `MutableList.Empty` symbol rather than `undefined`, so `undefined`
  // can still be stored as a value.
  const first = MutableList.take(jobs)
  yield* Console.log(first === MutableList.Empty ? 'idle' : `running ${first}`)

  // `takeN` and `takeAll` drain in batches.
  yield* Console.log(MutableList.takeN(jobs, 2))
  yield* Console.log(MutableList.takeAll(jobs), jobs.length)
  yield* Console.log(MutableList.take(jobs) === MutableList.Empty)

  // Every change is visible to everyone holding the collection, and there
  // is no earlier version to go back to. Keep mutable collections local to
  // one function or service. When several fibers share state, or you want
  // snapshots, keep an immutable `HashMap` in a `Ref` instead.
})
