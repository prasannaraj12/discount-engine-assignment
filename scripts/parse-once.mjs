// Makes exactly ONE live parser call through the real server pipeline
// (provider → server Zod check → client adapter + domain validation) and
// prints the result. Nothing is added to any cart; no prices are calculated.
//
//   npm run parse:once                      show what would be sent (no call)
//   npm run parse:once -- --yes             make the single call
//   npm run parse:once -- --yes "10% off Flipkart"
//
// Reads LLM_PROVIDER and the provider's key from .env. The key is never printed.
import { existsSync } from 'node:fs'
import { handleParseRule, createProvider, providerConfigProblem, resolveProviderConfig } from '../server/parseRule.js'
import { adaptLlmResult } from '../src/adapters/naturalLanguageAdapter.js'

if (existsSync('.env') && typeof process.loadEnvFile === 'function') process.loadEnvFile('.env')

const args = process.argv.slice(2)
const confirmed = args.includes('--yes')
const text = args.filter((a) => a !== '--yes').join(' ').trim() || '20% off for Natura Casa brand, stackable with other offers'
const context = { brands: ['Natura Casa', 'LivSpace Pro', 'Nordic Basics'], platforms: ['Amazon India', 'Flipkart', 'Noon'] }

const cfg = resolveProviderConfig()
const problem = providerConfigProblem()
console.log(`Provider: ${cfg.name}   Model: ${cfg.model ?? 'n/a'}   Key: ${cfg.apiKey ? 'set' : 'MISSING'}`)
console.log(`Text:     "${text}"`)
if (problem) {
  console.error(`\nNot configured: ${problem}.`)
  process.exit(1)
}
if (!confirmed) {
  console.log('\nDry run: no API call made. Re-run with --yes to make exactly one call.')
  process.exit(0)
}

const started = Date.now()
const res = await handleParseRule({ text, context }, { provider: createProvider(), ip: 'parse-once' })
console.log(`\nHTTP ${res.status} in ${Date.now() - started} ms (1 API call)`)
if (res.status !== 200) {
  console.log(`Error: ${res.body.error}: ${res.body.message}`)
  process.exit(1)
}

console.log('\nModel output (passed server-side Zod validation):')
console.log(JSON.stringify(res.body.result, null, 2))

const view = adaptLlmResult(res.body.result, { text, existingRules: [], cartItems: [] })
console.log(`\nApp outcome: ${view.kind}`)
if (view.kind === 'review') {
  console.log(view.validation.ok ? 'Domain validation: PASSED' : `Domain validation: REJECTED: ${view.validation.errors.join('; ')}`)
  if (view.validation.ok) console.log(JSON.stringify(view.validation.rule, null, 2))
  if (view.warnings.length) console.log('Cross-check warnings:\n- ' + view.warnings.join('\n- '))
} else {
  console.log(view.message)
}
