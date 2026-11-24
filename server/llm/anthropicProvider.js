/**
 * Anthropic (Claude) implementation of the rule-parser provider interface:
 *
 *   provider.parseRule(text, context) → Promise<unknown>   (raw structured JSON)
 *
 * To use a different LLM, add another module with the same function and
 * select it in createProvider(). Nothing else in the app changes.
 */
import Anthropic from '@anthropic-ai/sdk'
import { betaZodOutputFormat } from '@anthropic-ai/sdk/helpers/beta/zod'
import { llmRuleSchema } from './ruleOutputSchema.js'
import { SYSTEM_PROMPT, buildUserMessage } from './prompt.js'
import { ProviderError } from './errors.js'

export const DEFAULT_ANTHROPIC_MODEL = 'claude-opus-5-5'
export const DEFAULT_MODEL = DEFAULT_ANTHROPIC_MODEL // kept for existing imports

export { ProviderError } // re-exported for existing imports

export function createAnthropicProvider({ apiKey, model = DEFAULT_ANTHROPIC_MODEL, timeoutMs = 25000 }) {
  const client = new Anthropic({ apiKey, timeout: timeoutMs, maxRetries: 1 })

  return {
    name: 'anthropic',
    model,
    async parseRule(text, context) {
      let response
      try {
        response = await client.beta.messages.parse({
          model,
          max_tokens: 4000,
          // Short extraction task: low effort keeps latency and cost down.
          output_config: { effort: 'low', format: betaZodOutputFormat(llmRuleSchema) },
          // If the primary model declines, the API retries on a fallback model.
          betas: ['server-side-fallback-2026-07-01'],
          fallbacks: 'default',
          system: SYSTEM_PROMPT,
          messages: [{ role: 'user', content: buildUserMessage(text, context) }],
        })
      } catch (err) {
        if (err instanceof Anthropic.AuthenticationError || err instanceof Anthropic.PermissionDeniedError) {
          throw new ProviderError('provider_auth', 'The AI service rejected the server credentials.', 502)
        }
        if (err instanceof Anthropic.RateLimitError) {
          throw new ProviderError('provider_rate_limited', 'The AI service is busy. Please try again in a moment.', 429)
        }
        if (err instanceof Anthropic.APIConnectionTimeoutError || err instanceof Anthropic.APIConnectionError) {
          throw new ProviderError('provider_unreachable', 'Could not reach the AI service. Please try again.', 503)
        }
        if (err instanceof Anthropic.APIError) {
          throw new ProviderError('provider_error', `The AI service returned an error (${err.status ?? 'unknown'}).`, 502)
        }
        // e.g. the SDK failed to parse the model's JSON against the schema
        throw new ProviderError('invalid_model_output', 'The AI returned a response that could not be read.', 502)
      }

      if (response.stop_reason === 'refusal') {
        throw new ProviderError('provider_refused', 'The AI declined to interpret this text.', 422)
      }
      if (response.stop_reason === 'max_tokens' || !response.parsed_output) {
        throw new ProviderError('invalid_model_output', 'The AI returned an incomplete response.', 502)
      }
      return response.parsed_output
    },
  }
}
