/**
 * @title Testing handlers
 * @difficulty intermediate
 * @summary Handlers get their dependencies from services, so a test can swap
 * in fakes. `HttpApiTest` then calls the handlers through the full HTTP
 * pipeline with a typed client, without a server or a network.
 */

import { Console, Context, Effect, Layer, Ref, Schema } from 'effect'
import { HttpServer } from 'effect/http'
import {
  HttpApi,
  HttpApiBuilder,
  HttpApiEndpoint,
  HttpApiGroup,
  HttpApiTest,
} from 'effect/http-api'

// The handler sends a welcome email through this service. In production it
// talks to an email provider.
class Mailer extends Context.Service<
  Mailer,
  { send(to: string, subject: string): Effect.Effect<void> }
>()('app/Mailer') {}

const Api = HttpApi.make('app')
  .add(
    HttpApiGroup.make('signup').add(
      HttpApiEndpoint.post('register', '/signup', {
        payload: Schema.Struct({ email: Schema.String }),
        success: Schema.Struct({ welcome: Schema.String }),
      }),
    ),
  )
  .add(
    HttpApiGroup.make('admin').add(
      HttpApiEndpoint.get('stats', '/admin/stats', { success: Schema.Int }),
    ),
  )

// The handlers ask for `Mailer` but do not choose an implementation. The
// group layer therefore requires `Mailer`.
const SignupLive = HttpApiBuilder.group(
  Api,
  'signup',
  Effect.fn(function* (handlers) {
    const mailer = yield* Mailer
    return handlers.handle('register', ({ payload }) =>
      mailer
        .send(payload.email, 'Welcome!')
        .pipe(Effect.as({ welcome: payload.email })),
    )
  }),
)

export const program = Effect.gen(function* () {
  // A fake mailer that records what it was asked to send.
  const outbox = yield* Ref.make<ReadonlyArray<string>>([])
  const MailerTest = Layer.succeed(Mailer, {
    send: (to, subject) =>
      Ref.update(outbox, (sent) => [...sent, `${to}: ${subject}`]),
  })

  yield* Effect.gen(function* () {
    // Select the groups under test. Only their handlers must be provided.
    const client = yield* HttpApiTest.groups(Api, ['signup'])

    yield* Console.log(
      yield* client.signup.register({ payload: { email: 'ada@example.com' } }),
    )
    yield* Console.log(yield* Ref.get(outbox))

    // Endpoints in groups you did not select are still routed, but have no
    // handler. Calling one is a defect, which makes a test fail loudly.
    yield* client.admin
      .stats()
      .pipe(
        Effect.catchDefect((defect) =>
          Console.log(`defect: ${String(defect)}`),
        ),
      )
  }).pipe(
    Effect.provide(
      Layer.mergeAll(
        SignupLive.pipe(Layer.provide(MailerTest)),
        HttpServer.layerServices,
      ),
    ),
  )
}).pipe(Effect.scoped)
