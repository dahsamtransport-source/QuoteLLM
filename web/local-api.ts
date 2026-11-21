import { Readable } from 'node:stream'
import { fileURLToPath } from 'node:url'
import { loadEnv, type Plugin } from 'vite'

// Run the real Edge handlers locally; provider keys remain on the Node server.
export function localApi(): Plugin {
  return {
    name: 'quotellm-local-api',
    configureServer(server) {
      const root = fileURLToPath(new URL('..', import.meta.url))
      const env = loadEnv('development', root, '')
      for (const key of ['OPENAI_API_KEY', 'ELEVENLABS_API_KEY', 'ELEVENLABS_VOICE_ID']) {
        if (!process.env[key] && env[key]) process.env[key] = env[key]
      }
      server.middlewares.use(async (req, res, next) => {
        const url = new URL(req.url || '/', 'http://127.0.0.1:5173')
        if (!url.pathname.startsWith('/api/')) return next()
        const name = url.pathname.slice(5)
        if (!['chat', 'ocr', 'stt', 'tts', 'mcp', 'chart'].includes(name)) {
          res.statusCode = 404
          return res.end('Not found')
        }
        try {
          const module = await server.ssrLoadModule(`${root}/api/${name}.ts`)
          const headers = new Headers()
          for (const [key, value] of Object.entries(req.headers)) {
            if (value !== undefined) headers.set(key, Array.isArray(value) ? value.join(', ') : value)
          }
          const init = { method: req.method, headers } as RequestInit & { duplex?: string }
          if (req.method !== 'GET' && req.method !== 'HEAD') {
            init.body = Readable.toWeb(req) as ReadableStream<Uint8Array>
            init.duplex = 'half'
          }
          const response: Response = await module.default(new Request(url, init))
          res.statusCode = response.status
          response.headers.forEach((value, key) => res.setHeader(key, value))
          if (!response.body) return res.end()
          Readable.fromWeb(response.body as never).pipe(res)
        } catch {
          res.statusCode = 500
          res.setHeader('Content-Type', 'application/json')
          res.end(JSON.stringify({ error: 'Local API request failed' }))
        }
      })
    },
  }
}
