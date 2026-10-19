/**
 * @title Workflows over RPC
 * @difficulty advanced
 * @summary Workflows usually run on a server, but other services need to
 * start them. `WorkflowProxy` derives RPC definitions from your workflows,
 * and `WorkflowProxyServer` implements them, so a client can execute a
 * workflow without importing its code.
 */

import { Console, Effect, Layer, Schema } from 'effect'
import { RpcTest } from 'effect/rpc'
import {
  Workflow,
  WorkflowEngine,
  WorkflowProxy,
  WorkflowProxyServer,
} from 'effect/workflow'

class InvalidAddress extends Schema.TaggedError<InvalidAddress>()(
  'InvalidAddress',
  { address: Schema.String },
) {}

// The workflow definition is shared by client and server. Its handler,
// below, stays on the server.
const SendInvoice = Workflow.make('SendInvoice', {
  payload: { invoiceId: Schema.String, email: Schema.String },
  success: Schema.String,
  error: InvalidAddress,
  idempotencyKey: ({ invoiceId }) => invoiceId,
})

const workflows = [SendInvoice] as const

// Each workflow becomes three RPCs: run it and wait for the result, start it
// in the background, and resume a suspended execution.
class InvoiceRpcs extends WorkflowProxy.toRpcGroup(workflows) {}

const SendInvoiceLive = SendInvoice.toLayer(({ invoiceId, email }) =>
  Effect.gen(function* () {
    if (!email.includes('@')) {
      return yield* new InvalidAddress({ address: email })
    }
    return `invoice ${invoiceId} sent to ${email}`
  }),
)

// `layerRpcHandlers` implements every RPC by calling the workflow on the
// engine. Here the engine is in memory.
const ServerLive = WorkflowProxyServer.layerRpcHandlers(workflows).pipe(
  Layer.provide(SendInvoiceLive),
  Layer.provideMerge(WorkflowEngine.layerMemory),
)

export const program = Effect.gen(function* () {
  yield* Console.log([...InvoiceRpcs.requests.keys()])

  // `RpcTest.makeClient` connects a client straight to the handlers. Over a
  // network you would serve `InvoiceRpcs` with `RpcServer` instead.
  const client = yield* RpcTest.makeClient(InvoiceRpcs)

  const sent = yield* client.SendInvoice({
    invoiceId: 'inv-1',
    email: 'ada@example.com',
  })
  yield* Console.log(sent)

  // The workflow's typed error travels back to the caller.
  const failure = yield* client
    .SendInvoice({ invoiceId: 'inv-2', email: 'not-an-email' })
    .pipe(Effect.flip)
  yield* Console.log(`${failure._tag}: ${failure.address}`)

  // The `Discard` variant returns as soon as the workflow has started, with
  // its execution ID. That ID is the one the server derives from the
  // workflow name and idempotency key.
  const payload = { invoiceId: 'inv-3', email: 'bob@example.com' }
  const executionId = yield* client.SendInvoiceDiscard(payload)
  const expected = yield* SendInvoice.executionId(payload)
  yield* Console.log(`same execution: ${executionId === expected}`)
}).pipe(Effect.provide(ServerLive), Effect.scoped)
