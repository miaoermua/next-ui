import http from 'node:http'
import https from 'node:https'

const UPSTREAM_TIMEOUT_MS = 10_000

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

function stripPort(host) {
  const value = String(host || '').trim()

  if (!value) {
    return ''
  }

  if (value.startsWith('[')) {
    const end = value.indexOf(']')
    if (end > 0) {
      return value.slice(1, end)
    }
  }

  const colonCount = (value.match(/:/g) || []).length
  if (colonCount === 1 && value.includes(':')) {
    return value.split(':')[0]
  }

  return value
}

function isPrivateIpv4(host) {
  if (!/^\d{1,3}(?:\.\d{1,3}){3}$/.test(host)) {
    return false
  }

  const parts = host.split('.').map((item) => Number(item))
  if (parts.some((item) => Number.isNaN(item) || item < 0 || item > 255)) {
    return false
  }

  if (parts[0] === 10) {
    return true
  }

  if (parts[0] === 127) {
    return true
  }

  if (parts[0] === 192 && parts[1] === 168) {
    return true
  }

  if (parts[0] === 172 && parts[1] >= 16 && parts[1] <= 31) {
    return true
  }

  if (parts[0] === 169 && parts[1] === 254) {
    return true
  }

  return false
}

function isPrivateIpv6(host) {
  const normalized = host.toLowerCase()

  if (normalized === '::1') {
    return true
  }

  if (normalized.startsWith('fc') || normalized.startsWith('fd')) {
    return true
  }

  return normalized.startsWith('fe8') || normalized.startsWith('fe9') || normalized.startsWith('fea') || normalized.startsWith('feb')
}

function isPrivateTargetHost(targetHost) {
  const host = stripPort(targetHost).toLowerCase()

  if (!host) {
    return false
  }

  if (host === 'localhost' || host.endsWith('.local')) {
    return true
  }

  if (host.includes(':')) {
    return isPrivateIpv6(host)
  }

  return isPrivateIpv4(host)
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

  const parsed = new URL(originalUrl, 'http://router-api.local')
  const queryPath = parsed.searchParams.get('__path')

  if (queryPath) {
    const decodedPath = decodeURIComponent(queryPath)
    if (decodedPath.startsWith('/')) {
      return decodedPath
    }

    return `/${decodedPath}`
  }

  let trimmedPath = parsed.pathname

  if (trimmedPath.startsWith('/api/router-api/')) {
    trimmedPath = trimmedPath.slice('/api/router-api'.length)
  } else if (trimmedPath === '/api/router-api') {
    trimmedPath = '/'
  } else if (trimmedPath.startsWith('/router-api/')) {
    trimmedPath = trimmedPath.slice('/router-api'.length)
  } else if (trimmedPath === '/router-api') {
    trimmedPath = '/'
  }

  if (!trimmedPath.startsWith('/')) {
    trimmedPath = `/${trimmedPath}`
  }

  const query = parsed.searchParams.toString()
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

  if (process.env.VERCEL && isPrivateTargetHost(targetHost)) {
    res.writeHead(400, { 'Content-Type': 'application/json; charset=utf-8' })
    res.end(
      JSON.stringify({
        ok: false,
        error: 'private_target_not_reachable',
        message:
          '当前服务部署在 Vercel，无法直接访问 10.x/172.16-31.x/192.168.x 等内网地址。请改用公网可达域名，或把前端部署到与路由器同一内网。',
        target: targetOrigin
      })
    )
    return
  }

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

  upstreamRequest.setTimeout(UPSTREAM_TIMEOUT_MS, () => {
    upstreamRequest.destroy(new Error(`upstream timeout after ${UPSTREAM_TIMEOUT_MS}ms`))
  })

  upstreamRequest.on('error', (error) => {
    const rawMessage = String(error?.message || 'upstream request failed')
    const friendlyMessage = /ENOTFOUND/i.test(rawMessage)
      ? `DNS 解析失败（${targetHost}）。请确认域名可被公网解析，且 Vercel 区域可访问。`
      : rawMessage

    if (!res.headersSent) {
      res.writeHead(502, { 'Content-Type': 'application/json; charset=utf-8' })
    }

    res.end(
      JSON.stringify({
        ok: false,
        error: 'proxy_error',
        message: friendlyMessage,
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
