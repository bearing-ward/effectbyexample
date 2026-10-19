/**
 * @title Local state with AtomRef
 * @difficulty beginner
 * @summary `AtomRef` is a small observable cell that needs no registry. It
 * suits state owned by one component, such as a form or a list being edited.
 * You can focus on one property, derive read-only views, and keep a
 * collection whose items notify on their own.
 */

import { Console, Effect } from 'effect'
import { AtomRef } from 'effect/reactivity'

export const program = Effect.gen(function* () {
  // `AtomRef.make` creates a ref with a starting value. Read it with
  // `.value`, change it with `set` or `update`. Like the rest of
  // `effect/reactivity`, `AtomRef` is marked `@stability unstable`.
  const form = AtomRef.make({ title: 'Buy milk', done: false })
  const log: Array<string> = []
  form.subscribe((value) => log.push(`form: ${JSON.stringify(value)}`))

  // `prop` focuses on one field. Writing through it produces a new parent
  // object, so subscribers of the whole form hear about it too.
  const done = form.prop('done')
  done.subscribe((value) => log.push(`done: ${value}`))
  done.set(true)

  // `map` derives a read-only ref. It only notifies when its own value
  // changes, so editing the title leaves this one quiet.
  const label = form.map((todo) => (todo.done ? 'completed' : 'open'))
  label.subscribe((value) => log.push(`label: ${value}`))
  form.prop('title').update((title) => title.toUpperCase())
  yield* Console.log(log)
  yield* Console.log(`label is ${label.value}`)

  // Setting a value equal to the current one is skipped. Refs compare with
  // `Equal.equals`, which compares plain objects by their contents.
  log.length = 0
  form.set({ title: 'BUY MILK', done: true })
  yield* Console.log(`notifications for an equal value: ${log.length}`)

  // `AtomRef.collection` holds one ref per item. Editing an item through its
  // own ref notifies both that item's subscribers and the collection's.
  const todos = AtomRef.collection([
    { title: 'Write report', done: false },
    { title: 'Call plumber', done: false },
  ])
  let collectionChanges = 0
  todos.subscribe(() => collectionChanges++)

  const [report] = todos.value
  report?.prop('done').set(true)
  todos.push({ title: 'Water plants', done: false })
  yield* Console.log(`collection changed ${collectionChanges} times`)

  // `toArray` returns the plain values, ready to save.
  yield* Console.log(todos.toArray())
})
