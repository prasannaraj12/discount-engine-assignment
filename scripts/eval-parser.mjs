// Runs evals/parser-cases.json through the real pipeline:
//   LLM (server handler) → natural-language adapter → schema validation
// and reports per-category accuracy. Writes evals/results/latest.json (or subset.json with --only).
//
// Uses the provider selected by LLM_PROVIDER (groq | anthropic) and its key,
// from the environment or .env.
// Makes ONE API call per case (25 cases → 25 billable calls).
// Calls run one at a time with a pause between them (default 3 s) so a
// provider's per-minute rate limit doesn't show up as parser failures.
//   npm run eval:parser                     run everything (~2 min for 25 cases)
//   npm run eval:parser -- --dry            list the cases, make no calls
//   npm run eval:parser -- --delay=5000     pause 5 s between calls
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs'
import { handleParseRule, createProvider, providerConfigProblem } from '../server/parseRule.js'
import { adaptLlmResult } from '../src/adapters/naturalLanguageAdapter.js'

const delayArg = process.argv.find((a) => a.startsWith('--delay='))
const DELAY_MS = delayArg ? Math.max(0, Number(delayArg.split('=')[1]) || 0) : 3000
const sleep = (ms) => new Promise((r) => setTimeout(r, ms))

const allCases = JSON.parse(readFileSync(new URL('../evals/parser-cases.json', import.meta.url), 'utf8'))
// --only=id1,id2 runs just those cases and saves to evals/results/subset.json
// (so a partial re-run never overwrites the full-run record).
const onlyArg = process.argv.find((a) => a.startsWith('--only='))
const onlyIds = onlyArg ? onlyArg.slice('--only='.length).split(',').map((s) => s.trim()).filter(Boolean) : null
const unknownIds = onlyIds?.filter((id) => !allCases.some((c) => c.id === id)) ?? []
if (unknownIds.length) {
  console.error(`Unknown case id(s): ${unknownIds.join(', ')}`)
  process.exit(1)
}
const cases = onlyIds ? allCases.filter((c) => onlyIds.includes(c.id)) : allCases
const RESULTS_FILE = onlyIds ? 'subset.json' : 'latest.json'

if (process.argv.includes('--dry')) {
  for (const c of cases) console.log(`${c.id.padEnd(22)} expect ${c.expect.outcome.padEnd(19)} ${c.text}`)
  console.log(`\n${cases.length} cases → ${cases.length} API calls if run.`)
  process.exit(0)
}

if (existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env')
const provider = createProvider()
if (!provider) {
  console.error(`AI provider not configured: ${providerConfigProblem()}. Cannot run the parser evaluation.`)
  process.exit(1)
}

const context = { brands: ['Natura Casa', 'LivSpace Pro', 'Nordic Basics'], platforms: ['Amazon India', 'Flipkart', 'Noon'] }

function outcomeOf(view) {
  // A rule the app would refuse to confirm (failed validation or a blocking wording check) counts as rejected.
  if (view.kind === 'review') return view.validation.ok && view.blockers.length === 0 ? 'rule' : 'invalid'
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
console.log(`Running ${cases.length} cases against ${provider.name} / ${provider.model}, ${DELAY_MS} ms apart…\n`)
for (const [i, c] of cases.entries()) {
  if (i > 0 && DELAY_MS > 0) await sleep(DELAY_MS)
  const started = Date.now()
  const res = await handleParseRule({ text: c.text, context }, { provider, ip: `eval-${c.id}` })
  const ms = Date.now() - started
  if (res.status !== 200) {
    // Provider/parser failure (no usable model output), kept separate from business-validation rejections.
    rows.push({ id: c.id, text: c.text, expected: c.expect.outcome, outcome: `error:${res.body.error}`, errorMessage: res.body.message, modelOutput: null, pass: false, ms })
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
    modelOutput: res.body.result, // raw JSON from the model, after the server's Zod shape check
    validationErrors: view.validation && !view.validation.ok ? view.validation.errors : [],
    blockers: view.blockers ?? [],
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
  provider: provider.name,
  model: provider.model,
  delayMs: DELAY_MS,
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
writeFileSync(new URL(`../evals/results/${RESULTS_FILE}`, import.meta.url), JSON.stringify({ summary, rows }, null, 2) + '\n')

const fmt = (r) => (r ? `${r.passed}/${r.total} (${Math.round((r.passed / r.total) * 100)}%)` : 'n/a')
console.log(`
Provider / model:        ${provider.name} / ${summary.model}
Parsed (schema-valid):   ${fmt(summary.parsed)}
Correct interpretation:  ${fmt(summary.correctInterpretation)}
Clarification asked:     ${fmt(summary.clarification)}
Invalid rule rejected:   ${fmt(summary.invalidRejected)}
Unsupported detected:    ${fmt(summary.unsupportedDetected)}
Overall:                 ${fmt(summary.overall)}
Median latency:          ${summary.medianLatencyMs} ms
Saved: evals/results/${RESULTS_FILE}`)
const misses = rows.filter((r) => !r.pass)
if (misses.length) {
  console.log('\nMismatches:')
  for (const m of misses) console.log(`- ${m.id}: expected ${m.expected}${m.expectedRule ? ' ' + JSON.stringify(m.expectedRule) : ''}, got ${m.outcome}${m.rule ? ' ' + JSON.stringify(m.rule) : ''}`)
}
