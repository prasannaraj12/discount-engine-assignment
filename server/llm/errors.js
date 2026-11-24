/**
 * Errors every LLM provider throws. handleParseRule() turns them into HTTP
 * responses with user-facing messages. Messages must never contain secrets
 * or raw provider responses.
 */
export class ProviderError extends Error {
  constructor(code, message, httpStatus = 502) {
    super(message)
    this.code = code
    this.httpStatus = httpStatus
  }
}
