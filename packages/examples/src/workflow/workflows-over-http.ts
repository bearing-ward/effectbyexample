/**
 * @title Workflows over HTTP
 * @difficulty advanced
 * @summary The same proxy works for HTTP. `WorkflowProxy.toHttpApiGroup`
 * turns workflows into `POST` endpoints you can add to any `HttpApi`, with
 * a typed client like the rest of your API.
 */

import { Console, Effect, Layer, Schema } from 'effect'
import { HttpServer } from 'effect/http'
import { HttpApi, HttpApiTest } from 'effect/http-api'
import {
  Workflow,
  WorkflowEngine,
  WorkflowProxy,
  WorkflowProxyServer,
} from 'effect/workflow'

// `httpApiStatus` sets the status code the error is sent with.
class InvalidAddress extends Schema.TaggedError<InvalidAddress>()(
  'InvalidAddress',
  { address: Schema.String },
  { httpApiStatus: 422 },
) {}

const SendInvoice = Workflow.make('SendInvoice', {
  payload: { invoiceId: Schema.String, email: Schema.String },
  success: Schema.String,
  error: InvalidAddress,
  idempotencyKey: ({ invoiceId }) => invoiceId,
})

const workflows = [SendInvoice] as const

// The generated group is an ordinary `HttpApiGroup`, so it takes a prefix
// and sits next to hand-written groups.
class BillingApi extends HttpApi.make('billing').add(
  WorkflowProxy.toHttpApiGroup('workflows', workflows).prefix('/workflows'),
) {}

const SendInvoiceLive = SendInvoice.toLayer(({ invoiceId, email }) =>
  Effect.gen(function* () {
    if (!email.includes('@')) {
      return yield* new InvalidAddress({ address: email })
    }
    return `invoice ${invoiceId} sent to ${email}`
  }),
)

// `layerHttpApi` implements the group's handlers with the workflows.
// `HttpServer.layerServices` provides the platform services the HTTP
// pipeline needs.
const ServerLive = WorkflowProxyServer.layerHttpApi(
  BillingApi,
  'workflows',
  workflows,
).pipe(
  Layer.provide(SendInvoiceLive),
  Layer.provideMerge(WorkflowEngine.layerMemory),
  Layer.merge(HttpServer.layerServices),
)

export const program = Effect.gen(function* () {
  // The workflow name, lowercased, becomes the path.
  for (const endpoint of Object.values(BillingApi.groups.workflows.endpoints)) {
    yield* Console.log(`${endpoint.method} ${endpoint.path}`)
  }

  // `HttpApiTest.groups` gives a typed client that sends real HTTP requests
  // through the API's routing and encoding, in memory.
  const client = yield* HttpApiTest.groups(BillingApi, ['workflows'])

  const sent = yield* client.workflows.SendInvoice({
    payload: { invoiceId: 'inv-1', email: 'ada@example.com' },
  })
  yield* Console.log(sent)

  // The error response is decoded back into the typed error. The client
  // can also fail with `HttpClientError` or `SchemaError`, so we pick out
  // the workflow's error by its tag.
  const failure = yield* client.workflows
    .SendInvoice({ payload: { invoiceId: 'inv-2', email: 'not-an-email' } })
    .pipe(
      Effect.catchTag('InvalidAddress', (error) =>
        Effect.succeed(`${error._tag}: ${error.address}`),
      ),
    )
  yield* Console.log(failure)
}).pipe(Effect.provide(ServerLive), Effect.scoped)
