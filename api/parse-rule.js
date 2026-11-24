// Vercel serverless function: POST /api/parse-rule
import { handleParseRule, createProvider } from '../server/parseRule.js'

export default async function handler(req, res) {
  if (req.method !== 'POST') {
    res.setHeader('Allow', 'POST')
    return res.status(405).json({ error: 'method_not_allowed', message: 'Use POST.' })
  }
  const ip = String(req.headers['x-forwarded-for'] ?? '').split(',')[0].trim() || 'unknown'
  const body = typeof req.body === 'string' ? safeJson(req.body) : req.body
  const { status, body: payload } = await handleParseRule(body, { provider: createProvider(), ip })
  return res.status(status).json(payload)
}

function safeJson(s) {
  try {
    return JSON.parse(s)
  } catch {
    return null
  }
}
