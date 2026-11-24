import { defineConfig, loadEnv } from 'vite'
import react from '@vitejs/plugin-react'

/**
 * Serves /api/parse-rule during `npm run dev` with the same handler Vercel
 * uses in production, so the API key stays server-side locally too.
 */
function apiDevServer(env) {
  return {
    name: 'api-dev-server',
    configureServer(server) {
      server.middlewares.use('/api/parse-rule', async (req, res) => {
        const { handleParseRule, createProvider, providerConfigProblem } = await import('./server/parseRule.js')
        const send = (status, payload) => {
          res.statusCode = status
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify(payload))
        }
        if (req.method !== 'POST') return send(405, { error: 'method_not_allowed', message: 'Use POST.' })
        let raw = ''
        for await (const chunk of req) raw += chunk
        let body = null
        try {
          body = JSON.parse(raw)
        } catch {
          /* handled as empty input */
        }
        const result = await handleParseRule(body, { provider: createProvider(env), configProblem: providerConfigProblem(env), ip: req.socket.remoteAddress })
        send(result.status, result.body)
      })
    },
  }
}

export default defineConfig(({ mode }) => {
  const env = loadEnv(mode, process.cwd(), '') // includes non-VITE_ vars; never exposed to the client bundle
  return {
    plugins: [react(), apiDevServer(env)],
    test: { environment: 'node' },
  }
})
