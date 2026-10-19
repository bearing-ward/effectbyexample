import { Array, Option, pipe, Schema, String } from 'effect'

import {
  Difficulty,
  type Example,
  type ExampleRuntime,
  type Segment,
} from './example.ts'

const Header = Schema.Struct({
  title: Schema.NonEmptyString,
  difficulty: Difficulty,
  summary: Schema.NonEmptyString,
})

const headerPattern = /^\/\*\*([\s\S]*?)\*\/\s*/u

const parseHeader = (block: string) =>
  pipe(
    block.split('\n'),
    Array.map((line) => line.replace(/^\s*\*\s?/u, '').trimEnd()),
    Array.reduce(
      { tags: {} as Record<string, string>, current: '' },
      (state, line) => {
        const tag = /^@(\w+)\s*(.*)$/u.exec(line)
        if (tag) {
          const [, name = '', text = ''] = tag
          return { tags: { ...state.tags, [name]: text }, current: name }
        }
        if (state.current === '' || line === '') {
          return state
        }
        const previous = state.tags[state.current] ?? ''
        return {
          tags: { ...state.tags, [state.current]: `${previous} ${line}` },
          current: state.current,
        }
      },
    ),
    (state) => Schema.decodeUnknownSync(Header)(state.tags),
  )

const isProse = (line: string) => line.trimStart().startsWith('//')

type Draft = { prose: Array<string>; code: Array<string> }

const toSegment = (draft: Draft): Segment => ({
  prose: draft.prose.join(' ').replace(/\s+/gu, ' ').trim(),
  code: draft.code.join('\n').replace(/^\n+|\n+$/gu, ''),
})

export const parseSegments = (body: string): ReadonlyArray<Segment> =>
  pipe(
    body.split('\n'),
    Array.reduce(Array.empty<Draft>(), (drafts, line) => {
      const last = Array.last(drafts)
      if (isProse(line)) {
        const text = line.trimStart().replace(/^\/\/\s?/u, '')
        if (last._tag === 'Some' && Array.isArrayEmpty(last.value.code)) {
          return Array.append(Array.dropRight(drafts, 1), {
            prose: Array.append(last.value.prose, text),
            code: last.value.code,
          })
        }
        return Array.append(drafts, { prose: [text], code: [] })
      }
      if (last._tag === 'None') {
        return String.isEmpty(line.trim())
          ? drafts
          : [{ prose: [], code: [line] }]
      }
      return Array.append(Array.dropRight(drafts, 1), {
        prose: last.value.prose,
        code: Array.append(last.value.code, line),
      })
    }),
    Array.map(toSegment),
    Array.filter((segment) => segment.prose !== '' || segment.code !== ''),
  )

const serverSuffix = '.server.ts'

/** `checks.ts` is a browser example; `files.server.ts` needs a server runtime. */
export const exampleFile = (
  fileName: string,
): Option.Option<{
  readonly slug: string
  readonly runtime: ExampleRuntime
}> => {
  if (!fileName.endsWith('.ts') || fileName.endsWith('.test.ts')) {
    return Option.none()
  }
  return fileName.endsWith(serverSuffix)
    ? Option.some({
        slug: fileName.slice(0, -serverSuffix.length),
        runtime: 'server',
      })
    : Option.some({
        slug: fileName.slice(0, -'.ts'.length),
        runtime: 'browser',
      })
}

export const parseExample = (
  category: string,
  slug: string,
  source: string,
  runtime: ExampleRuntime = 'browser',
): Example => {
  const header = headerPattern.exec(source)
  if (!header) {
    throw new Error(`${category}/${slug} is missing its /** @title */ header`)
  }
  const body = source.slice(header[0].length)
  return {
    category,
    slug,
    runtime,
    ...parseHeader(header[1] ?? ''),
    segments: parseSegments(body),
    source: body.trim(),
  }
}
