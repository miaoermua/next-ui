import {
  buildRouterHeaders,
  fetchMaybeJson,
  getDefaultRouterAddress,
  getDefaultRouterScheme,
  getRuntimeRouterAddress,
  getRuntimeRouterScheme,
  getUbusSessionToken,
  normalizeRouterAddress,
  resolveApiUrl,
  setRuntimeRouterAddressState
} from './transport'

let runtimeUbusSession = getUbusSessionToken()
let runtimeLuciAuthenticated = false
let runtimeLuciStok = ''

export function getRouterAuthState() {
  return {
    authenticated: runtimeUbusSession !== getUbusSessionToken(),
    luciAuthenticated: runtimeLuciAuthenticated,
    token: runtimeUbusSession,
    address: `${getRuntimeRouterScheme()}://${getRuntimeRouterAddress()}`
  }
}

export function resetRouterAuth() {
  runtimeUbusSession = getUbusSessionToken()
  runtimeLuciAuthenticated = false
  runtimeLuciStok = ''
}

export function setRouterAddress(address) {
  const normalized = normalizeRouterAddress(address)

  if (!normalized.valid) {
    throw new Error('路由器地址格式无效，请输入 192.168.1.1 或 http://192.168.1.1')
  }

  const previousAddress = getRuntimeRouterAddress()
  const previousScheme = getRuntimeRouterScheme()
  const changed = normalized.address !== previousAddress || normalized.scheme !== previousScheme

  setRuntimeRouterAddressState(normalized.address, normalized.scheme)

  if (changed) {
    runtimeUbusSession = getUbusSessionToken()
    runtimeLuciAuthenticated = false
    runtimeLuciStok = ''
  }

  return getRouterAuthState()
}

async function loginUbus(username, password) {
  const payload = await fetchMaybeJson('/ubus', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'call',
      params: [getUbusSessionToken(), 'session', 'login', { username, password }]
    })
  })

  if (payload?.error) {
    throw new Error('登录失败（ubus error）')
  }

  if (!Array.isArray(payload?.result)) {
    throw new Error('登录失败（ubus 返回格式异常）')
  }

  const ubusCode = Number(payload.result[0])
  if (ubusCode !== 0) {
    if (ubusCode === 6) {
      throw new Error('登录失败：用户名或密码错误（ubus code 6）')
    }

    throw new Error(`登录失败（ubus code ${ubusCode}）`)
  }

  if (!payload.result[1]?.ubus_rpc_session) {
    throw new Error('登录失败（ubus 未返回会话）')
  }

  runtimeUbusSession = payload.result[1].ubus_rpc_session
}

async function loginLuci(username, password) {
  const body = new URLSearchParams({
    luci_username: username,
    luci_password: password,
    username,
    password
  })

  const response = await fetch(resolveApiUrl('/cgi-bin/luci'), {
    method: 'POST',
    headers: {
      ...buildRouterHeaders(),
      'Content-Type': 'application/x-www-form-urlencoded'
    },
    body: body.toString(),
    credentials: 'include'
  })

  if (!response.ok) {
    throw new Error(`LuCI 登录请求失败（HTTP ${response.status}）`)
  }

  const location = response.headers.get('location') || ''
  const stokMatch = location.match(/;stok=([a-zA-Z0-9]+)/)
  if (stokMatch) {
    runtimeLuciStok = stokMatch[1]
  }

  if (location.includes('192.168.1.1') && getRuntimeRouterAddress() !== '192.168.1.1') {
    throw new Error(`LuCI 返回了默认地址跳转（${location}），请确认路由器 base URL 配置`)
  }

  runtimeLuciAuthenticated = true
}

export async function loginRouter(username, password) {
  if (!username || !password) {
    throw new Error('用户名和密码不能为空')
  }

  await loginUbus(username, password)

  let warning = ''
  try {
    await loginLuci(username, password)
  } catch (error) {
    runtimeLuciAuthenticated = false
    warning = error?.message || 'LuCI 会话建立失败'
  }

  return {
    ...getRouterAuthState(),
    warning
  }
}

export function resolveLuciPath(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  if (runtimeLuciStok) {
    return `/cgi-bin/luci/;stok=${runtimeLuciStok}${normalizedPath}`
  }

  return `/cgi-bin/luci${normalizedPath}`
}

export function getRouterDefaults() {
  const envAddress = String(import.meta.env.VITE_ROUTER_ADDRESS || '').trim()
  const envPassword = String(import.meta.env.VITE_ROUTER_PASSWORD || '')
  const normalizedAddress = normalizeRouterAddress(envAddress)
  const hasCredential = Boolean(envPassword)

  return {
    address: normalizedAddress.valid
      ? `${normalizedAddress.scheme}://${normalizedAddress.address}`
      : `${getDefaultRouterScheme()}://${getDefaultRouterAddress()}`,
    password: envPassword,
    autoLogin: parseBooleanEnv(import.meta.env.VITE_ROUTER_AUTO_LOGIN, hasCredential)
  }
}

function parseBooleanEnv(value, fallback = false) {
  const text = String(value ?? '').trim().toLowerCase()
  if (!text) {
    return fallback
  }

  if (['1', 'true', 'yes', 'on'].includes(text)) {
    return true
  }

  if (['0', 'false', 'no', 'off'].includes(text)) {
    return false
  }

  return fallback
}

