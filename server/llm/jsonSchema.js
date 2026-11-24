/**
 * Converts the Zod output schema to plain JSON Schema for providers that take
 * a JSON Schema directly (Groq / OpenAI-compatible), and checks it against
 * Groq's documented strict-mode restrictions
 * (https://console.groq.com/docs/structured-outputs):
 *   - every property must be listed in `required` (no optional fields)
 *   - every object must set `additionalProperties: false`
 *   - nullable values use a type union with "null"; anyOf is allowed
 *   - supported: string, number, integer, boolean, object, array, enum, anyOf, $defs/$ref
 * The checker is deliberately conservative: any keyword not in that list is
 * reported, so a future schema change can't silently break strict mode.
 */
import * as z from 'zod/v4'

const ALLOWED_KEYWORDS = new Set(['type', 'properties', 'required', 'additionalProperties', 'items', 'enum', 'anyOf', 'description', '$defs', '$ref'])
const ALLOWED_TYPES = new Set(['string', 'number', 'integer', 'boolean', 'object', 'array', 'null'])

export function toProviderJsonSchema(zodSchema) {
  const { $schema, ...schema } = z.toJSONSchema(zodSchema) // drop the dialect marker; Groq's docs don't list it
  return schema
}

/** @returns {string[]} violations, empty when the schema is strict-mode compatible */
export function strictSchemaViolations(schema, path = '$') {
  const out = []
  if (typeof schema !== 'object' || schema === null) return [`${path}: not a schema object`]

  for (const key of Object.keys(schema)) {
    if (!ALLOWED_KEYWORDS.has(key)) out.push(`${path}: unsupported keyword "${key}"`)
  }
  const types = schema.type === undefined ? [] : [].concat(schema.type)
  for (const t of types) if (!ALLOWED_TYPES.has(t)) out.push(`${path}: unsupported type "${t}"`)

  if (types.includes('object') || schema.properties) {
    const props = Object.keys(schema.properties ?? {})
    const required = new Set(schema.required ?? [])
    for (const p of props) if (!required.has(p)) out.push(`${path}.${p}: must be listed in "required" (optional fields are not supported)`)
    if (schema.additionalProperties !== false) out.push(`${path}: objects must set additionalProperties: false`)
    for (const p of props) out.push(...strictSchemaViolations(schema.properties[p], `${path}.${p}`))
  }
  if (schema.items) out.push(...strictSchemaViolations(schema.items, `${path}[]`))
  if (schema.anyOf) schema.anyOf.forEach((s, i) => out.push(...strictSchemaViolations(s, `${path}.anyOf[${i}]`)))
  if (schema.$defs) for (const [k, s] of Object.entries(schema.$defs)) out.push(...strictSchemaViolations(s, `${path}.$defs.${k}`))
  return out
}
