// Runs evals/parser-cases.json through the real pipeline:
//   LLM (server handler) → natural-language adapter → schema validation
// and reports how often the final outcome matches the expected one.
//
// Requires ANTHROPIC_API_KEY (in the environment or .env). Each run makes
// one API call per case (20 calls) and therefore costs real money.
//   npm run eval:parser
import { readFileSync, existsSync } from 'node:fs'
import { handleParseRule, createProvider } from '../server/parseRule.js'
import { adaptLlmResult } from '../src/adapters/naturalLanguageAdapter.js'

if (existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env')
const provider = createProvider()
if (!provider) {
  console.error('ANTHROPIC_API_KEY is not set — cannot run the parser evaluation.')
  process.exit(1)
}

const cases = JSON.parse(readFileSync(new URL('../evals/parser-cases.json', import.meta.url), 'utf8'))
const context = { brands: ['Natura Casa', 'LivSpace Pro', 'Nordic Basics'], platforms: ['Amazon India', 'Flipkart', 'Noon'] }

function outcomeOf(view) {
  if (view.kind === 'review') return view.validation.ok ? 'rule' : 'invalid'
  return view.kind // clarify | unsupported
}

function matches(expect, outcome, view) {
  if (expect.outcome === 'invalid_or_clarify') return outcome === 'invalid' || outcome === 'clarify'
  if (expect.outcome !== outcome) return false
  if (expect.rule) {
    const rule = view.validation.rule
    return Object.entries(expect.rule).every(([k, v]) => {
      const got = rule[k]
      return typeof v === 'string' ? String(got).toLowerCase() === v.toLowerCase() : got === v
    })
  }
  return true
}

let pass = 0
let schemaValid = 0
const failures = []
for (const c of cases) {
  const res = await handleParseRule({ text: c.text, context }, { provider, ip: `eval-${c.id}` })
  if (res.status !== 200) {
    failures.push(`${c.id}: HTTP ${res.status} ${res.body.message}`)
    console.log(`✗ ${c.id.padEnd(22)} HTTP ${res.status}`)
    continue
  }
  schemaValid++
  const view = adaptLlmResult(res.body.result, { text: c.text, existingRules: [], cartItems: [] })
  const outcome = outcomeOf(view)
  const ok = matches(c.expect, outcome, view)
  if (ok) pass++
  else failures.push(`${c.id}: expected ${c.expect.outcome}${c.expect.rule ? ' ' + JSON.stringify(c.expect.rule) : ''}, got ${outcome}${view.validation?.rule ? ' ' + JSON.stringify(view.validation.rule) : ''}`)
  console.log(`${ok ? '✓' : '✗'} ${c.id.padEnd(22)} ${outcome}`)
}

console.log(`\nModel: ${provider.model}`)
console.log(`Schema-valid responses: ${schemaValid}/${cases.length}`)
console.log(`Expected outcome:       ${pass}/${cases.length} (${Math.round((pass / cases.length) * 100)}%)`)
if (failures.length) console.log('\nMismatches:\n- ' + failures.join('\n- '))
