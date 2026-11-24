// Runs evals/parser-cases.json through the real pipeline:
//   LLM (server handler) → natural-language adapter → schema validation
// and reports per-category accuracy. Writes evals/results/latest.json.
//
// Requires ANTHROPIC_API_KEY (in the environment or .env).
// Makes ONE API call per case (25 cases → 25 billable calls).
//   npm run eval:parser             run everything
//   npm run eval:parser -- --dry    list the cases, make no calls
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { handleParseRule, createProvider } from '../server/parseRule.js'
import { adaptLlmResult } from '../src/adapters/naturalLanguageAdapter.js'

const cases = JSON.parse(readFileSync(new URL('../evals/parser-cases.json', import.meta.url), 'utf8'))

if (process.argv.includes('--dry')) {
  for (const c of cases) console.log(`${c.id.padEnd(22)} expect ${c.expect.outcome.padEnd(19)} ${c.text}`)
  console.log(`\n${cases.length} cases → ${cases.length} API calls if run.`)
  process.exit(0)
}

if (existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env')
const provider = createProvider()
if (!provider) {
  console.error('ANTHROPIC_API_KEY is not set — cannot run the parser evaluation.')
  process.exit(1)
}

const context = { brands: ['Natura Casa', 'LivSpace Pro', 'Nordic Basics'], platforms: ['Amazon India', 'Flipkart', 'Noon'] }

function outcomeOf(view) {
  if (view.kind === 'review') return view.validation.ok ? 'rule' : 'invalid'
  return view.kind // clarify | unsupported
}

function matches(expect, outcome, view) {
  if (expect.outcome === 'invalid_or_clarify') return outcome === 'invalid' || outcome === 'clarify'
  if (expect.outcome !== outcome) return false
  if (!expect.rule) return true
  const rule = view.validation.rule
  return Object.entries(expect.rule).every(([k, v]) => (typeof v === 'string' ? String(rule[k]).toLowerCase() === v.toLowerCase() : rule[k] === v))
}

const rows = []
console.log(`Running ${cases.length} cases against ${provider.model}…\n`)
for (const c of cases) {
  const started = Date.now()
  const res = await handleParseRule({ text: c.text, context }, { provider, ip: `eval-${c.id}` })
  const ms = Date.now() - started
  if (res.status !== 200) {
    rows.push({ id: c.id, text: c.text, expected: c.expect.outcome, outcome: `error:${res.body.error}`, pass: false, ms })
    console.log(`✗ ${c.id.padEnd(22)} HTTP ${res.status} ${res.body.error}`)
    continue
  }
  const view = adaptLlmResult(res.body.result, { text: c.text, existingRules: [], cartItems: [] })
  const outcome = outcomeOf(view)
  const pass = matches(c.expect, outcome, view)
  rows.push({
    id: c.id,
    text: c.text,
    expected: c.expect.outcome,
    expectedRule: c.expect.rule ?? null,
    outcome,
    rule: view.validation?.rule ?? null,
    warnings: view.warnings ?? [],
    message: view.message ?? null,
    pass,
    ms,
  })
  console.log(`${pass ? '✓' : '✗'} ${c.id.padEnd(22)} ${outcome.padEnd(11)} ${ms} ms`)
}

const rate = (subset) => (subset.length ? { passed: subset.filter((r) => r.pass).length, total: subset.length } : null)
const of = (...kinds) => rows.filter((r) => kinds.includes(r.expected))
const responded = rows.filter((r) => !r.outcome.startsWith('error:'))
const summary = {
  model: provider.model,
  runAt: new Date().toISOString(),
  cases: rows.length,
  parsed: { passed: responded.length, total: rows.length }, // HTTP 200 with schema-valid structured output
  schemaRejected: rows.filter((r) => r.outcome === 'error:invalid_model_output').length,
  correctInterpretation: rate(of('rule')), // right rule, right fields
  clarification: rate(of('clarify')), // asked a question instead of guessing
  invalidRejected: rate(of('invalid', 'invalid_or_clarify')), // out-of-range values never became rules
  unsupportedDetected: rate(of('unsupported')),
  overall: rate(rows),
  medianLatencyMs: [...rows.map((r) => r.ms)].sort((a, b) => a - b)[Math.floor(rows.length / 2)],
}

mkdirSync(new URL('../evals/results/', import.meta.url), { recursive: true })
writeFileSync(new URL('../evals/results/latest.json', import.meta.url), JSON.stringify({ summary, rows }, null, 2) + '\n')

const fmt = (r) => (r ? `${r.passed}/${r.total} (${Math.round((r.passed / r.total) * 100)}%)` : 'n/a')
console.log(`
Model:                   ${summary.model}
Parsed (schema-valid):   ${fmt(summary.parsed)}
Correct interpretation:  ${fmt(summary.correctInterpretation)}
Clarification asked:     ${fmt(summary.clarification)}
Invalid rule rejected:   ${fmt(summary.invalidRejected)}
Unsupported detected:    ${fmt(summary.unsupportedDetected)}
Overall:                 ${fmt(summary.overall)}
Median latency:          ${summary.medianLatencyMs} ms
Saved: evals/results/latest.json`)
const misses = rows.filter((r) => !r.pass)
if (misses.length) {
  console.log('\nMismatches:')
  for (const m of misses) console.log(`- ${m.id}: expected ${m.expected}${m.expectedRule ? ' ' + JSON.stringify(m.expectedRule) : ''}, got ${m.outcome}${m.rule ? ' ' + JSON.stringify(m.rule) : ''}`)
}
