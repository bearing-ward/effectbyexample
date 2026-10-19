import { categories } from '@ebe/examples'

type Bindings = { ASSETS: Fetcher }

const health = {
  status: 'ok',
  examples: categories.reduce(
    (count, category) => count + category.slugs.length,
    0,
  ),
}

export default {
  async fetch(request: Request, env: Bindings): Promise<Response> {
    const url = new URL(request.url)
    if (url.pathname === '/api/health') {
      return Response.json(health)
    }
    if (url.pathname.startsWith('/api/')) {
      return Response.json({ error: 'Not found' }, { status: 404 })
    }
    return env.ASSETS.fetch(request)
  },
}
