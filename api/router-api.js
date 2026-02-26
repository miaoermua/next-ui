import http from 'node:http'
import https from 'node:https'

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

function getRawPathFromRequest(req) {
  const originalUrl = String(req.url || '')

  if (!originalUrl) {
    return '/'
  }

  const [pathname = '', query = ''] = originalUrl.split('?')

  let trimmedPath = pathname

  if (pathname.startsWith('/api/router-api/')) {
    trimmedPath = pathname.slice('/api/router-api'.length)
  } else if (pathname === '/api/router-api') {
    trimmedPath = '/'
  } else if (pathname.startsWith('/router-api/')) {
    trimmedPath = pathname.slice('/router-api'.length)
  } else if (pathname === '/router-api') {
    trimmedPath = '/'
  }

  if (!trimmedPath.startsWith('/')) {
    trimmedPath = `/${trimmedPath}`
  }

  return query ? `${trimmedPath}?${query}` : trimmedPath
}

function serializeParsedBody(req) {
  if (req.body === undefined || req.body === null) {
    return null
  }

  if (Buffer.isBuffer(req.body)) {
    return req.body
  }

  if (typeof req.body === 'string') {
    return Buffer.from(req.body)
  }

  const contentType = String(req.headers['content-type'] || '').toLowerCase()

  if (contentType.includes('application/x-www-form-urlencoded') && typeof req.body === 'object') {
    const params = new URLSearchParams()

    for (const [key, value] of Object.entries(req.body)) {
      if (Array.isArray(value)) {
        value.forEach((item) => params.append(key, String(item ?? '')))
        continue
      }

      params.append(key, String(value ?? ''))
    }

    return Buffer.from(params.toString())
  }

  if (typeof req.body === 'object') {
    return Buffer.from(JSON.stringify(req.body))
  }

  return Buffer.from(String(req.body))
}

export default function handler(req, res) {
  const fallbackHost = '192.168.1.1'
  const targetHost = sanitizeTargetValue(req.headers['x-router-host'], fallbackHost)
  const targetScheme = sanitizeSchemeValue(req.headers['x-router-scheme'], 'http')
  const targetOrigin = `${targetScheme}://${targetHost}`

  const rawPath = getRawPathFromRequest(req)
  const targetUrl = new URL(rawPath, targetOrigin)

  const method = String(req.method || 'GET').toUpperCase()
  const hasRequestBody = method !== 'GET' && method !== 'HEAD'

  const headers = {
    ...req.headers,
    host: targetHost,
    origin: targetOrigin
  }

  delete headers['x-router-host']
  delete headers['x-router-scheme']

  const parsedBody = hasRequestBody ? serializeParsedBody(req) : null

  if (!hasRequestBody) {
    delete headers['content-length']
    delete headers['transfer-encoding']
  } else if (parsedBody !== null) {
    headers['content-length'] = String(parsedBody.length)
    delete headers['transfer-encoding']
  }

  const transport = targetScheme === 'https' ? https : http
  const upstreamRequest = transport.request(
    {
      protocol: targetUrl.protocol,
      hostname: targetUrl.hostname,
      port: targetUrl.port || (targetScheme === 'https' ? 443 : 80),
      method,
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

  if (!hasRequestBody) {
    upstreamRequest.end()
    return
  }

  if (parsedBody !== null) {
    upstreamRequest.end(parsedBody)
    return
  }

  if (req.readableEnded) {
    upstreamRequest.end()
    return
  }

  req.pipe(upstreamRequest)
}
