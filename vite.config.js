import http from 'node:http'
import https from 'node:https'
import { defineConfig } from 'vite'
import preact from '@preact/preset-vite'

function sanitizeTargetValue(value, fallback) {
  const text = String(value || '').trim()
  if (!text) {
    return fallback
  }

  try {
    const parsed = new URL(/^https?:\/\//i.test(text) ? text : `http://${text}`)
    return parsed.host || fallback
  } catch {
    return fallback
  }
}

function sanitizeSchemeValue(value, fallback = 'http') {
  const normalized = String(value || '').toLowerCase()
  return normalized === 'https' ? 'https' : fallback
}

function rewriteSetCookie(cookie, proxyBasePath = '/router-api') {
  const segments = String(cookie)
    .split(';')
    .map((segment) => segment.trim())

  const rewritten = segments
    .map((segment) => {
      if (/^Domain=/i.test(segment)) {
        return ''
      }

      if (/^Path=/i.test(segment)) {
        const originalPath = segment.slice(5) || '/'
        const normalizedPath = originalPath.startsWith('/') ? originalPath : `/${originalPath}`
        return `Path=${proxyBasePath}${normalizedPath}`
      }

      if (/^Secure$/i.test(segment)) {
        return ''
      }

      return segment
    })
    .filter(Boolean)

  if (!rewritten.some((segment) => /^Path=/i.test(segment))) {
    rewritten.push(`Path=${proxyBasePath}/`)
  }

  return rewritten.join('; ')
}

function createRouterApiMiddleware() {
  return (req, res, next) => {
    if (!req.url || !req.url.startsWith('/router-api')) {
      next()
      return
    }

    const fallbackHost = '192.168.1.1'
    const targetHost = sanitizeTargetValue(req.headers['x-router-host'], fallbackHost)
    const targetScheme = sanitizeSchemeValue(req.headers['x-router-scheme'], 'http')
    const targetOrigin = `${targetScheme}://${targetHost}`

    const rawPath = req.url.replace(/^\/router-api/, '') || '/'
    const targetUrl = new URL(rawPath, targetOrigin)

    const headers = {
      ...req.headers,
      host: targetHost,
      origin: targetOrigin
    }

    delete headers['x-router-host']
    delete headers['x-router-scheme']

    console.log(
      `[router-api] ${req.method || 'GET'} ${rawPath} -> ${targetOrigin}`,
      `(x-router-host=${req.headers['x-router-host'] || 'none'}, x-router-scheme=${req.headers['x-router-scheme'] || 'none'})`
    )

    const transport = targetScheme === 'https' ? https : http
    const upstreamRequest = transport.request(
      {
        protocol: targetUrl.protocol,
        hostname: targetUrl.hostname,
        port: targetUrl.port || (targetScheme === 'https' ? 443 : 80),
        method: req.method,
        path: `${targetUrl.pathname}${targetUrl.search}`,
        headers
      },
      (upstreamResponse) => {
        const responseHeaders = { ...upstreamResponse.headers }

        if (responseHeaders['set-cookie']) {
          const cookies = Array.isArray(responseHeaders['set-cookie'])
            ? responseHeaders['set-cookie']
            : [responseHeaders['set-cookie']]

          const rewrittenCookies = cookies.map((cookie) => rewriteSetCookie(cookie, '/router-api'))
          responseHeaders['set-cookie'] = rewrittenCookies
        }

        res.writeHead(upstreamResponse.statusCode || 502, responseHeaders)
        upstreamResponse.pipe(res)
      }
    )

    upstreamRequest.on('error', (error) => {
      console.error(`[router-api] upstream error -> ${targetOrigin}${rawPath}:`, error.message)
      if (!res.headersSent) {
        res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
      }

      res.end(
        JSON.stringify({
          ok: false,
          error: 'proxy_error',
          message: error.message,
          target: `${targetOrigin}${rawPath}`
        })
      )
    })

    if (req.method === 'GET' || req.method === 'HEAD') {
      upstreamRequest.end()
      return
    }

    req.pipe(upstreamRequest)
  }
}

export default defineConfig({
  plugins: [
    preact(),
    {
      name: 'router-api-dynamic-proxy',
      configureServer(server) {
        server.middlewares.use(createRouterApiMiddleware())
      }
    }
  ],
  resolve: {
    alias: {
      react: 'preact/compat',
      'react-dom': 'preact/compat',
      'react/jsx-runtime': 'preact/jsx-runtime'
    }
  }
})
