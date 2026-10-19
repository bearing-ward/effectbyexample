import { Array, pipe } from 'effect'

const maxLineWidth = 72

const isPlainObject = (value: object) => {
  const prototype = Object.getPrototypeOf(value)
  return prototype === Object.prototype || prototype === null
}

const identifier = /^[A-Za-z_$][\w$]*$/u

const formatKey = (key: string) =>
  identifier.test(key) ? key : `'${key.replaceAll("'", "\\'")}'`

const wrap = (
  open: string,
  close: string,
  parts: Array<string>,
  indent: number,
) => {
  if (Array.isArrayEmpty(parts)) {
    return `${open}${close}`
  }
  const inline = `${open} ${parts.join(', ')} ${close}`
  if (inline.length <= maxLineWidth && !inline.includes('\n')) {
    return inline
  }
  const padding = ' '.repeat(indent + 2)
  return `${open}\n${parts.map((part) => `${padding}${part}`).join(',\n')}\n${' '.repeat(indent)}${close}`
}

const formatNested = (value: unknown, indent: number): string => {
  if (typeof value === 'string') {
    return `'${value.replaceAll("'", "\\'")}'`
  }
  if (typeof value === 'bigint') {
    return `${value}n`
  }
  if (typeof value === 'symbol' || typeof value === 'function') {
    return String(value)
  }
  if (value === null || typeof value !== 'object') {
    return String(value)
  }
  if (value instanceof Date) {
    return value.toISOString()
  }
  if (value instanceof Error) {
    return `${value.name}: ${value.message}`
  }
  if (globalThis.Array.isArray(value)) {
    return wrap(
      '[',
      ']',
      value.map((item) => formatNested(item, indent + 2)),
      indent,
    )
  }
  if (value instanceof Set) {
    return `Set(${value.size}) ${wrap(
      '{',
      '}',
      [...value].map((item) => formatNested(item, indent + 2)),
      indent,
    )}`
  }
  if (value instanceof Map) {
    return `Map(${value.size}) ${wrap(
      '{',
      '}',
      [...value].map(
        ([key, item]) =>
          `${formatNested(key, indent + 2)} => ${formatNested(item, indent + 2)}`,
      ),
      indent,
    )}`
  }
  if ('toJSON' in value && typeof value.toJSON === 'function') {
    return formatNested(value.toJSON(), indent)
  }
  const fields = pipe(
    Object.entries(value),
    Array.map(
      ([key, item]) => `${formatKey(key)}: ${formatNested(item, indent + 2)}`,
    ),
  )
  const body = wrap('{', '}', fields, indent)
  const name: unknown = isPlainObject(value)
    ? undefined
    : (value as { readonly constructor?: { readonly name?: unknown } })
        .constructor?.name
  return typeof name === 'string' && name !== '' ? `${name} ${body}` : body
}

/** Formats a value the way `console.log` would print it in a terminal. */
export const formatValue = (value: unknown): string =>
  typeof value === 'string' ? value : formatNested(value, 0)

export const formatArguments = (values: ReadonlyArray<unknown>): string =>
  values.map(formatValue).join(' ')
