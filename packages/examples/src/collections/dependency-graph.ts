/**
 * @title Dependency graphs
 * @difficulty advanced
 * @summary The `Graph` module stores nodes and the edges between them, and
 * ships the algorithms you would otherwise write by hand: topological
 * ordering, reachability, cycle detection, shortest paths. Here it plans the
 * order of build steps. `Graph` is marked unstable, so its API may change
 * in a minor release.
 */

import { Console, Effect, Graph, Option } from 'effect'

export const program = Effect.gen(function* () {
  // `Graph.directed` builds an immutable graph. Inside the callback the
  // graph is mutable: `addNode` returns a numeric index, and `addEdge`
  // connects two indices. An edge here means "must finish before". We
  // keep the indices so we can refer to the nodes later.
  const ids = { install: 0, codegen: 0, compile: 0, test: 0, bundle: 0 }
  const build = Graph.directed<string, string>((g) => {
    ids.install = Graph.addNode(g, 'install')
    ids.codegen = Graph.addNode(g, 'codegen')
    ids.compile = Graph.addNode(g, 'compile')
    ids.test = Graph.addNode(g, 'test')
    ids.bundle = Graph.addNode(g, 'bundle')
    Graph.addEdge(g, ids.install, ids.codegen, 'needs packages')
    Graph.addEdge(g, ids.codegen, ids.compile, 'needs types')
    Graph.addEdge(g, ids.compile, ids.test, 'needs build')
    Graph.addEdge(g, ids.compile, ids.bundle, 'needs build')
  })
  yield* Console.log(Graph.nodeCount(build), Graph.edgeCount(build))

  // A topological order lists every step after all the steps it depends
  // on. `topo` returns a walker; `Graph.values` gives the node data.
  yield* Console.log(Array.from(Graph.values(Graph.topo(build))))

  // `dfs` from one node finds everything reachable from it: the steps that
  // must rerun when codegen changes.
  const affected = Graph.dfs(build, { start: [ids.codegen] })
  yield* Console.log(Array.from(Graph.values(affected)))

  // `hasPath` answers a single reachability question.
  yield* Console.log(Graph.hasPath(build, ids.test, ids.install))

  // `mutate` makes a changed copy. Someone adds an edge that makes install
  // wait for the tests, which closes a loop.
  const broken = Graph.mutate(build, (g) => {
    Graph.addEdge(g, ids.test, ids.install, 'oops')
  })

  // A cyclic graph has no valid order, and `topo` throws on one. Check
  // first, and use `findCycle` to tell the user which steps form the loop.
  yield* Console.log(Graph.isAcyclic(build), Graph.isAcyclic(broken))
  const cycle = Graph.findCycle(broken).pipe(
    Option.map(({ path }) =>
      path
        .map((index) => Option.getOrThrow(Graph.getNode(broken, index)))
        .join(' -> '),
    ),
  )
  yield* Console.log(cycle)

  // The original graph is untouched.
  yield* Console.log(Graph.edgeCount(build), Graph.edgeCount(broken))
})
