import { pipe, Schema } from 'effect'
import { Route } from 'foldkit'
import { defineRouteUnion, slash, string } from 'foldkit/route'
import type { Url } from 'foldkit/url'

export const AppRoute = defineRouteUnion({
  Home: {},
  Example: { category: Schema.String, slug: Schema.String },
  NotFound: { path: Schema.String },
})
export type AppRoute = typeof AppRoute.Type

// The site may be served below a path, such as `/effectbyexample/` on GitHub
// Pages. Vite's `base` sets `BASE_URL`; routes are parsed without it and
// printed with it.
const base = import.meta.env.BASE_URL.replace(/\/$/u, '')

const homeRoute = pipe(Route.root, Route.mapTo(AppRoute.Home))

const exampleRoute = pipe(
  string('category'),
  slash(string('slug')),
  Route.mapTo(AppRoute.Example),
)

export const homeRouter = () => `${base}${homeRoute()}`

export const exampleRouter = (
  params: Parameters<typeof exampleRoute>[0],
): string => `${base}${exampleRoute(params)}`

const parseRoute = Route.parseUrlWithFallback(
  Route.oneOf(exampleRoute, homeRoute),
  AppRoute.NotFound,
)

export const urlToAppRoute = (url: Url): AppRoute =>
  parseRoute(
    base !== '' &&
      (url.pathname === base || url.pathname.startsWith(`${base}/`))
      ? { ...url, pathname: url.pathname.slice(base.length) || '/' }
      : url,
  )
