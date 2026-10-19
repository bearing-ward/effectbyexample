/**
 * @title An MCP server for your tools
 * @difficulty advanced
 * @summary The Model Context Protocol (MCP) lets AI apps such as Claude
 * Desktop or an IDE call tools you host. `McpServer` serves an Effect
 * `Toolkit` and resources over MCP, so the same tools work inside your own
 * agent and in other apps. Here we talk to the server in memory over stdio.
 */

import {
  Console,
  Effect,
  Layer,
  Queue,
  Schema,
  Sink,
  Stdio,
  Stream,
} from 'effect'
import { McpProtocol, McpSchema, McpServer, Tool, Toolkit } from 'effect/ai'

// Ordinary tools, as you would pass to `generateText`. MCP clients see the
// annotations as hints. The defaults are cautious (a tool might change
// data), so mark a lookup as read-only and not destructive.
const GetOrderStatus = Tool.make('GetOrderStatus', {
  description: 'Look up the shipping status of an order',
  parameters: Schema.Struct({ orderId: Schema.String }),
  success: Schema.Struct({ status: Schema.String }),
})
  .annotate(Tool.Readonly, true)
  .annotate(Tool.Destructive, false)

const ShopTools = Toolkit.make(GetOrderStatus)
const ShopToolsLive = ShopTools.toLayer({
  GetOrderStatus: ({ orderId }) =>
    Effect.succeed({ status: `order ${orderId} is in transit` }),
})

// Each registration is a layer. `McpServer.layerStdio` serves them over
// standard input and output, which is how desktop apps launch local MCP
// servers. `McpProtocol` lists the protocol versions you accept.
const ShopServer = Layer.mergeAll(
  McpServer.toolkit(ShopTools),
  McpServer.resource({
    uri: 'shop://policies/returns',
    name: 'Return policy',
    content: Effect.succeed('Returns are accepted within 30 days.'),
  }),
).pipe(
  Layer.provide(ShopToolsLive),
  Layer.provideMerge(
    McpServer.layerStdio({
      name: 'shop',
      version: '1.0.0',
      protocols: [McpProtocol.v2025_06_18],
    }),
  ),
)

export const program = Effect.gen(function* () {
  // Instead of a real process, two queues stand in for stdin and stdout.
  const stdin = yield* Queue.unbounded<string>()
  const stdout = yield* Queue.unbounded<string | Uint8Array>()
  const pipes = Stdio.layerTest({
    stdin: Stream.fromQueue(stdin).pipe(Stream.encodeText),
    stdout: () => Sink.forEach((chunk) => Queue.offer(stdout, chunk)),
  })

  // Run the server in the background. When its output ends, a stdio server
  // interrupts the fiber that started it, as if the process exited, so it
  // gets a fiber of its own.
  yield* Layer.launch(ShopServer.pipe(Layer.provide(pipes))).pipe(
    Effect.forkScoped,
  )

  // Each message is one line of JSON-RPC. Replies come back in order.
  const decodeReply = Schema.decodeUnknownEffect(
    Schema.fromJsonString(Schema.Struct({ result: Schema.Unknown })),
  )
  const send = (message: object) =>
    Queue.offer(stdin, JSON.stringify({ jsonrpc: '2.0', ...message }) + '\n')
  const call = <S extends Schema.Top>(
    id: number,
    method: string,
    params: object,
    schema: S,
  ) =>
    send({ id, method, params }).pipe(
      Effect.andThen(Queue.take(stdout)),
      // `McpSchema` has schemas for every MCP message, so replies decode
      // into typed values.
      Effect.flatMap((line) => decodeReply(String(line))),
      Effect.flatMap((reply) =>
        Schema.decodeUnknownEffect(schema)(reply.result),
      ),
    )

  // A client starts by initializing, then confirms with a notification.
  const init = yield* call(
    1,
    'initialize',
    {
      protocolVersion: '2025-06-18',
      capabilities: {},
      clientInfo: { name: 'docs-client', version: '1.0.0' },
    },
    McpSchema.InitializeResult,
  )
  yield* Console.log('server:', init.serverInfo.name, init.protocolVersion)
  yield* send({ method: 'notifications/initialized' })

  // The toolkit's schemas become MCP JSON Schemas.
  const listed = yield* call(2, 'tools/list', {}, McpSchema.ListToolsResult)
  for (const tool of listed.tools) {
    yield* Console.log(tool.name, tool.inputSchema, tool.annotations)
  }

  // Calling the tool runs our handler. The result comes back as text and
  // as `structuredContent` matching the success schema.
  const called = yield* call(
    3,
    'tools/call',
    { name: 'GetOrderStatus', arguments: { orderId: '1042' } },
    McpSchema.CallToolResult,
  )
  yield* Console.log(called.content)
  yield* Console.log(called.structuredContent)

  // Resources are documents a client can read by URI, for example to put
  // them in the model's context.
  const policy = yield* call(
    4,
    'resources/read',
    { uri: 'shop://policies/returns' },
    McpSchema.ReadResourceResult,
  )
  yield* Console.log(policy.contents)
}).pipe(Effect.scoped)
