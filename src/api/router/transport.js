const UBUS_SESSION = '00000000000000000000000000000000'
const DEFAULT_ROUTER_ADDRESS = '192.168.1.1'
const DEFAULT_ROUTER_SCHEME = 'http'

let runtimeRouterAddress = DEFAULT_ROUTER_ADDRESS
let runtimeRouterScheme = DEFAULT_ROUTER_SCHEME

export function getRuntimeRouterAddress() {
  return runtimeRouterAddress
}

export function getRuntimeRouterScheme() {
  return runtimeRouterScheme
}

export function setRuntimeRouterAddressState(address, scheme) {
  runtimeRouterAddress = address
  runtimeRouterScheme = scheme
}

export function getDefaultRouterAddress() {
  return DEFAULT_ROUTER_ADDRESS
}

export function getDefaultRouterScheme() {
  return DEFAULT_ROUTER_SCHEME
}

export function normalizeRouterAddress(address) {
  const text = String(address || '').trim().replace(/\/$/, '')

  if (!text) {
    return {
      valid: false,
      address: DEFAULT_ROUTER_ADDRESS,
      scheme: DEFAULT_ROUTER_SCHEME
    }
  }

  const withScheme = /^https?:\/\//i.test(text) ? text : `${DEFAULT_ROUTER_SCHEME}://${text}`

  try {
    const parsed = new URL(withScheme)

    if (!parsed.host) {
      return {
        valid: false,
        address: DEFAULT_ROUTER_ADDRESS,
        scheme: DEFAULT_ROUTER_SCHEME
      }
    }

    return {
      valid: true,
      address: parsed.host || DEFAULT_ROUTER_ADDRESS,
      scheme: parsed.protocol.replace(':', '') || DEFAULT_ROUTER_SCHEME
    }
  } catch {
    return {
      valid: false,
      address: DEFAULT_ROUTER_ADDRESS,
      scheme: DEFAULT_ROUTER_SCHEME
    }
  }
}

export function resolveApiUrl(url) {
  const normalizedPath = url.startsWith('/') ? url : `/${url}`
  return `/router-api${normalizedPath}`
}

export function buildRouterHeaders(extraHeaders = {}) {
  return {
    'x-router-host': runtimeRouterAddress,
    'x-router-scheme': runtimeRouterScheme,
    ...extraHeaders
  }
}

export async function performRequest(url, init = {}) {
  const targetUrl = resolveApiUrl(url)
  const response = await fetch(targetUrl, {
    credentials: 'include',
    redirect: 'manual',
    ...init,
    headers: buildRouterHeaders(init.headers || {})
  })

  const contentType = response.headers.get('content-type') || ''
  let body

  if (contentType.includes('application/json')) {
    try {
      body = await response.json()
    } catch {
      body = null
    }
  } else {
    const text = await response.text()

    try {
      body = JSON.parse(text)
    } catch {
      body = text
    }
  }

  return {
    response,
    body,
    targetUrl
  }
}

export async function fetchMaybeJson(url, init) {
  const request = await performRequest(url, init)

  if (!request.response.ok) {
    throw new Error(`HTTP ${request.response.status} @ ${request.targetUrl}`)
  }

  return request.body
}

export function getUbusSessionToken() {
  return UBUS_SESSION
}

