const UBUS_SESSION = '00000000000000000000000000000000'
const REALTIME_CONNECTIONS_PATH = '/admin/status/realtime/connections/'
const REALTIME_BANDWIDTH_PATH = '/admin/status/realtime/bandwidth/'
const PROCESSES_PATH = '/admin/status/processes'
const STARTUP_PATH = '/admin/system/startup'
const PACKAGES_PATH = '/admin/system/packages?display=installed'
const NETWORK_LAN_PATH = '/admin/network/network/lan'
const NETWORK_WAN_PATH = '/admin/network/network/wan'
const NETWORK_DHCP_PATH = '/admin/network/dhcp'
const OPENCLASH_SETTINGS_PATH = '/admin/services/openclash/settings/'
const ADGUARD_HOME_PATH = '/admin/services/AdGuardHome'
const DDNS_GO_PATH = '/admin/services/ddns-go'
const APPFILTER_OAF_STATUS_PATH = '/admin/network/get_oaf_status'
const APPFILTER_BASE_PATH = '/admin/network/get_app_filter_base'
const OVERVIEW_STATUS_PATH = '/admin/status/overview?status=1'
const IFACE_STATUS_PATH = '/admin/network/iface_status/EasyTier,Hotspot,lan,tailscale,wan,wan6'
const OPENCLASH_TOOLBAR_PATH = '/admin/services/openclash/toolbar_show'
const ADGUARD_HOME_STATUS_PATH = '/admin/services/AdGuardHome/status'
const DDNS_GO_STATUS_PATH = '/admin/services/ddnsgo_status'
const DEFAULT_ROUTER_ADDRESS = '192.168.1.1'
const DEFAULT_ROUTER_SCHEME = 'http'

let runtimeUbusSession = UBUS_SESSION
let runtimeRouterAddress = DEFAULT_ROUTER_ADDRESS
let runtimeRouterScheme = DEFAULT_ROUTER_SCHEME
let runtimeLuciAuthenticated = false
let runtimeLuciStok = ''
let previousCounterSample = null
let previousIfaceTrafficSample = null
let runtimeBoardInfoCache = null
let runtimeCpuModelCache = null
let runtimeCpuModelProbeAttempted = false
let runtimeOverviewPageMetaCache = null
let runtimeUbusAvailable = true

function normalizeRouterAddress(address) {
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

function resolveApiUrl(url) {
  const normalizedPath = url.startsWith('/') ? url : `/${url}`
  return `/router-api${normalizedPath}`
}

function resolveLuciPath(path) {
  const normalizedPath = path.startsWith('/') ? path : `/${path}`

  if (runtimeLuciStok) {
    return `/cgi-bin/luci/;stok=${runtimeLuciStok}${normalizedPath}`
  }

  return `/cgi-bin/luci${normalizedPath}`
}

function buildRouterHeaders(extraHeaders = {}) {
  return {
    'x-router-host': runtimeRouterAddress,
    'x-router-scheme': runtimeRouterScheme,
    ...extraHeaders
  }
}


function isAccessDeniedError(error) {
  const message = String(error?.message || '').toLowerCase()
  return message.includes('access denied') || message.includes('ubus unavailable') || message.includes('ubus result failed') || message.includes('ubus error')
}

const fallbackLogCache = new Set()

function logUbusFallback(scope, reason) {
  const key = `${scope}|${reason}`
  if (fallbackLogCache.has(key)) {
    return
  }

  fallbackLogCache.add(key)

  if (typeof console !== 'undefined' && typeof console.warn === 'function') {
    console.warn(`[RouterAPI] UBUS fallback: ${scope} -> ${reason}`)
  }
}

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function extractNumbers(input) {
  if (typeof input !== 'string') {
    return []
  }

  const matches = input.match(/-?\d+(?:\.\d+)?/g)
  if (!matches) {
    return []
  }

  return matches.map((item) => Number(item)).filter((item) => Number.isFinite(item))
}

function getLatestTextLine(text) {
  return text
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)
    .at(-1)
}

function walkForNumber(value, preferredKeys) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return value
  }

  if (!value || typeof value !== 'object') {
    return null
  }

  for (const key of preferredKeys) {
    if (key in value && typeof value[key] === 'number' && Number.isFinite(value[key])) {
      return value[key]
    }
  }

  for (const key of Object.keys(value)) {
    const nested = walkForNumber(value[key], preferredKeys)
    if (nested !== null) {
      return nested
    }
  }

  return null
}

function readPayloadNumbers(payload) {
  if (typeof payload === 'string') {
    const latestLine = getLatestTextLine(payload)
    return extractNumbers(latestLine ?? payload)
  }

  if (Array.isArray(payload)) {
    return payload
      .flatMap((item) => readPayloadNumbers(item))
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item))
  }

  if (payload && typeof payload === 'object') {
    return Object.values(payload)
      .flatMap((item) => readPayloadNumbers(item))
      .map((item) => Number(item))
      .filter((item) => Number.isFinite(item))
  }

  return []
}

async function performRequest(url, init = {}) {
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

async function fetchMaybeJson(url, init) {
  const request = await performRequest(url, init)

  if (!request.response.ok) {
    throw new Error(`HTTP ${request.response.status} @ ${request.targetUrl}`)
  }

  return request.body
}

function bytesToMbps(value) {
  return (value * 8) / 1_000_000
}

function rawToMbps(raw) {
  const safe = Math.max(0, Number(raw) || 0)

  if (safe > 1_000_000) {
    return bytesToMbps(safe)
  }

  if (safe > 20_000) {
    return safe / 1000
  }

  return safe
}

function normalizeBandwidth(rawDown, rawUp, timestamp) {
  const down = Math.max(0, rawDown)
  const up = Math.max(0, rawUp)

  if (down > 10_000_000 || up > 10_000_000) {
    if (
      previousCounterSample &&
      timestamp > previousCounterSample.timestamp &&
      down >= previousCounterSample.down &&
      up >= previousCounterSample.up
    ) {
      const seconds = Math.max(1, timestamp - previousCounterSample.timestamp)
      const downRate = (down - previousCounterSample.down) / seconds
      const upRate = (up - previousCounterSample.up) / seconds

      previousCounterSample = { down, up, timestamp }

      return {
        downMbps: clamp(bytesToMbps(downRate), 0, 5000),
        upMbps: clamp(bytesToMbps(upRate), 0, 5000)
      }
    }

    previousCounterSample = { down, up, timestamp }
    return {
      downMbps: 0,
      upMbps: 0
    }
  }

  previousCounterSample = null

  return {
    downMbps: clamp(rawToMbps(down), 0, 5000),
    upMbps: clamp(rawToMbps(up), 0, 5000)
  }
}

function parseConnectionsPayload(payload) {
  if (typeof payload === 'object' && payload) {
    const direct = walkForNumber(payload, [
      'connections',
      'connection',
      'conntrack',
      'active_connections',
      'count'
    ])

    if (direct !== null) {
      return Math.round(Math.max(0, direct))
    }
  }

  const numbers = readPayloadNumbers(payload)

  if (numbers.length >= 2) {
    return Math.round(Math.max(0, numbers[1]))
  }

  if (numbers.length >= 1) {
    return Math.round(Math.max(0, numbers[numbers.length - 1]))
  }

  throw new Error('无法解析连接数数据')
}

function parseBandwidthPayload(payload) {
  const now = Math.floor(Date.now() / 1000)

  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const down = walkForNumber(payload, [
      'down',
      'download',
      'rx',
      'rx_bytes',
      'receive',
      'ingress',
      'rate_down'
    ])
    const up = walkForNumber(payload, [
      'up',
      'upload',
      'tx',
      'tx_bytes',
      'transmit',
      'egress',
      'rate_up'
    ])

    if (down !== null && up !== null) {
      return normalizeBandwidth(down, up, now)
    }
  }

  const numbers = readPayloadNumbers(payload)

  if (numbers.length >= 3) {
    const maybeTimestamp = numbers[0] > 1_000_000_000 ? Math.floor(numbers[0]) : now
    const down = numbers[1]
    const up = numbers[2]
    return normalizeBandwidth(down, up, maybeTimestamp)
  }

  if (numbers.length >= 2) {
    const down = numbers[numbers.length - 2]
    const up = numbers[numbers.length - 1]
    return normalizeBandwidth(down, up, now)
  }

  throw new Error('无法解析流量数据')
}

function formatBytes(value) {
  const safe = Math.max(0, Number(value) || 0)
  if (safe >= 1024 ** 3) {
    return `${(safe / 1024 ** 3).toFixed(2)} GB`
  }

  if (safe >= 1024 ** 2) {
    return `${(safe / 1024 ** 2).toFixed(0)} MB`
  }

  if (safe >= 1024) {
    return `${(safe / 1024).toFixed(0)} KB`
  }

  return `${safe.toFixed(0)} B`
}

function parseCpuUsagePercent(value) {
  if (typeof value === 'number' && Number.isFinite(value)) {
    return clamp(Math.round(value), 0, 100)
  }

  if (typeof value !== 'string') {
    return null
  }

  const match = value.match(/-?\d+(?:\.\d+)?/)
  if (!match) {
    return null
  }

  return clamp(Math.round(Number(match[0])), 0, 100)
}

function parseLoadAverage(value) {
  const numeric = Number(value)
  if (!Number.isFinite(numeric)) {
    return null
  }

  if (numeric > 1024) {
    return numeric / 65535
  }

  return numeric
}

function parseCpuCoresFromText(text) {
  if (typeof text !== 'string') {
    return null
  }

  const normalized = text.replace(/\s+/g, ' ').trim()
  if (!normalized) {
    return null
  }

  let match = normalized.match(/(?:^|\b)(\d+)\s*C\s*\d+\s*T(?:\b|$)/i)
  if (match?.[1]) {
    return Number(match[1])
  }

  match = normalized.match(/(?:^|\b)(\d+)\s*C(?:\b|$)/i)
  if (match?.[1]) {
    return Number(match[1])
  }

  match = normalized.match(/(?:^|\b)(\d+)\s*core(?:s)?(?:\b|$)/i)
  if (match?.[1]) {
    return Number(match[1])
  }

  return null
}

function parseCpuCores(...candidates) {
  for (const item of candidates) {
    if (typeof item === 'number' && Number.isFinite(item) && item >= 1 && item <= 256) {
      return Math.round(item)
    }

    if (typeof item === 'string') {
      const parsed = parseCpuCoresFromText(item)
      if (typeof parsed === 'number' && Number.isFinite(parsed) && parsed >= 1 && parsed <= 256) {
        return Math.round(parsed)
      }
    }
  }

  return null
}

function parseCpuModel(rawCpuInfo) {
  const text = String(rawCpuInfo || '').replace(/\s+/g, ' ').trim()

  if (!text) {
    return null
  }

  const brandPattern = /(AMD|Intel)/i
  if (brandPattern.test(text)) {
    return text
  }

  const mhzPattern = /\d+(?:\.\d+)?\s*MHz/i
  if (mhzPattern.test(text)) {
    return null
  }

  return text
}

function parseCpuModelFromCpuinfoText(text) {
  if (typeof text !== 'string') {
    return null
  }

  const lines = text.split(/\r?\n/)
  const lineCandidates = [
    /^model\s+name\s*:\s*(.+)$/i,
    /^hardware\s*:\s*(.+)$/i,
    /^processor\s*:\s*(.+)$/i,
    /^cpu\s*:\s*(.+)$/i
  ]

  for (const line of lines) {
    for (const pattern of lineCandidates) {
      const matched = line.match(pattern)
      if (matched?.[1]) {
        const parsed = parseCpuModel(matched[1])
        if (parsed) {
          return parsed
        }
      }
    }
  }

  const merged = lines.join(' ')
  const fallbackMatch = merged.match(/\b(?:AMD|Intel)[^\n]{4,120}/i)
  if (fallbackMatch?.[0]) {
    return parseCpuModel(fallbackMatch[0])
  }

  return null
}

function decodeMaybeBase64(text) {
  if (typeof text !== 'string') {
    return ''
  }

  const raw = text.trim()
  if (!raw) {
    return ''
  }

  try {
    const decoded = atob(raw)
    if (/model\s+name|vendor_id|processor|hardware/i.test(decoded)) {
      return decoded
    }
  } catch {
    // ignore
  }

  return raw
}

async function detectCpuModelFromProcCpuinfo() {
  try {
    const payload = await callUbus('file', 'read', { path: '/proc/cpuinfo' })
    const text = decodeMaybeBase64(
      String(payload?.data || payload?.content || payload?.stdout || payload?.result || '')
    )
    const parsed = parseCpuModelFromCpuinfoText(text)
    if (parsed) {
      return parsed
    }
  } catch {
    // ignore
  }

  try {
    const payload = await callUbus('file', 'exec', {
      command: 'cat',
      params: ['/proc/cpuinfo']
    })

    const text = String(payload?.stdout || payload?.data || '')
    const parsed = parseCpuModelFromCpuinfoText(text)
    if (parsed) {
      return parsed
    }
  } catch {
    // ignore
  }

  return null
}

async function readBoardInfoCached() {
  if (runtimeBoardInfoCache && typeof runtimeBoardInfoCache === 'object') {
    return runtimeBoardInfoCache
  }

  try {
    const boardInfo = await callUbus('system', 'board')
    if (boardInfo && typeof boardInfo === 'object') {
      runtimeBoardInfoCache = boardInfo
      return boardInfo
    }
  } catch {
    // ignore
  }

  return null
}

function parseOpenWrtVersion(payload) {
  if (payload && typeof payload === 'object' && !Array.isArray(payload)) {
    const release = payload.release
    if (release && typeof release === 'object') {
      const joinedRelease = [release.distribution, release.version, release.revision]
        .map((item) => String(item || '').trim())
        .filter(Boolean)
        .join(' ')

      if (joinedRelease) {
        return joinedRelease
      }

      if (typeof release.description === 'string' && release.description.trim()) {
        return release.description.trim()
      }
    }
  }

  const candidates = [
    payload?.release,
    payload?.distribution,
    payload?.version,
    payload?.system,
    payload?.firmware,
    payload?.boardinfo?.release,
    payload?.boardinfo?.description
  ]

  for (const item of candidates) {
    if (typeof item === 'string') {
      const text = item.trim()
      if (text) {
        return text
      }
    }
  }

  return null
}

function parseHostModel(payload) {
  const candidates = [
    payload?.hostname,
    payload?.model,
    payload?.system,
    payload?.board_name,
    payload?.target
  ]

  for (const item of candidates) {
    if (typeof item === 'string') {
      const text = item.trim()
      if (text) {
        return text
      }
    }
  }

  return null
}

function decodeHtmlEntities(text) {
  return String(text || '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&amp;/g, '&')
}

function parseOverviewMetaFromHtml(html) {
  if (typeof html !== 'string') {
    return {
      hostName: null,
      hostModel: null,
      firmwareVersion: null,
      kernelVersion: null
    }
  }

  const rows = Array.from(
    html.matchAll(/<tr[^>]*>\s*<td[^>]*>\s*([^<]+?)\s*<\/td>\s*<td[^>]*>([\s\S]*?)<\/td>\s*<\/tr>/gi)
  )

  const valueByLabel = {}
  rows.forEach((match) => {
    const label = stripHtml(match[1]).trim()
    const value = decodeHtmlEntities(stripHtml(match[2])).trim()
    if (label) {
      valueByLabel[label] = value
    }
  })

  return {
    hostName: valueByLabel['主机名'] || null,
    hostModel: valueByLabel['主机型号'] || null,
    firmwareVersion: valueByLabel['固件版本'] || null,
    kernelVersion: valueByLabel['内核版本'] || null
  }
}

async function readOverviewPageMetaCached() {
  if (runtimeOverviewPageMetaCache && typeof runtimeOverviewPageMetaCache === 'object') {
    return runtimeOverviewPageMetaCache
  }

  try {
    const payload = await fetchMaybeJson(resolveLuciPath('/admin/status/overview'))
    const parsed = parseOverviewMetaFromHtml(payload)

    runtimeOverviewPageMetaCache = parsed
    return parsed
  } catch {
    return null
  }
}

function parseOpenClashRateText(rawText) {
  const text = String(rawText || '').trim().toUpperCase()
  if (!text) {
    return 0
  }

  const match = text.match(/([\d.]+)\s*([KMGTP]?)(?:B)?\s*\/\s*S/)
  if (!match) {
    return 0
  }

  const value = Number(match[1])
  if (!Number.isFinite(value) || value < 0) {
    return 0
  }

  const unit = match[2] || ''
  const factorByUnit = {
    '': 1,
    K: 1_000,
    M: 1_000_000,
    G: 1_000_000_000,
    T: 1_000_000_000_000,
    P: 1_000_000_000_000_000
  }

  const bytesPerSecond = value * (factorByUnit[unit] || 1)
  return bytesToMbps(bytesPerSecond)
}

function parseEthInfo(rawEthInfo) {
  if (Array.isArray(rawEthInfo)) {
    return rawEthInfo
  }

  if (typeof rawEthInfo !== 'string') {
    return []
  }

  try {
    const parsed = JSON.parse(rawEthInfo)
    return Array.isArray(parsed) ? parsed : []
  } catch {
    return []
  }
}

function parsePortSpeed(speedText) {
  if (typeof speedText !== 'string') {
    return 0
  }

  const match = speedText.match(/(\d+(?:\.\d+)?)\s*Mb/i)
  if (!match) {
    return 0
  }

  return Number(match[1])
}

function normalizeLeaseItem(item, index) {
  if (!item || typeof item !== 'object') {
    return null
  }

  return {
    id: `${item.ipaddr || item.ip6addr || item.macaddr || 'lease'}-${index}`,
    hostname: item.hostname ? String(item.hostname) : '-',
    ipaddr: item.ipaddr || item.ip6addr || '-',
    macaddr: item.macaddr || '-',
    expires: Number(item.expires) || 0
  }
}

function normalizeLease6Item(item, index) {
  if (!item || typeof item !== 'object') {
    return null
  }

  const ip6addr = String(item.ip6addr || item.ipaddr || '-')
    .replace(/\s+/g, ' ')
    .trim()

  return {
    id: `${ip6addr || item.hostname || 'lease6'}-${index}`,
    hostname: item.hostname ? String(item.hostname) : '-',
    ip6addr: ip6addr || '-',
    expires: Number(item.expires) || 0
  }
}

function parseBooleanEnv(value, fallback) {
  const text = String(value || '').trim().toLowerCase()

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

function normalizeOverviewRates(payload) {
  const wan = payload?.wan || {}
  const rootDown = Number(payload?.wanrx)
  const rootUp = Number(payload?.wantx)
  const wanDown = Number(wan?.rx_rate || wan?.download_rate || wan?.down_rate)
  const wanUp = Number(wan?.tx_rate || wan?.upload_rate || wan?.up_rate)

  const downCandidate = [wanDown, rootDown].find((value) => Number.isFinite(value) && value >= 0)
  const upCandidate = [wanUp, rootUp].find((value) => Number.isFinite(value) && value >= 0)

  if (!Number.isFinite(downCandidate) || !Number.isFinite(upCandidate)) {
    return {
      wanDownMbps: null,
      wanUpMbps: null
    }
  }

  return {
    wanDownMbps: clamp(rawToMbps(downCandidate), 0, 5000),
    wanUpMbps: clamp(rawToMbps(upCandidate), 0, 5000)
  }
}

function findInterfaceById(payload, id) {
  if (!Array.isArray(payload)) {
    return null
  }

  return payload.find((item) => String(item?.id || '').toLowerCase() === id.toLowerCase()) || null
}

function isLikelyPublicIpv6(value) {
  const text = String(value || '').trim().toLowerCase()
  if (!text) {
    return false
  }

  return !(text.startsWith('fe80') || text.startsWith('fd2d'))
}

function pickPrimaryPublicIp(candidates, kind = 'ipv4') {
  const list = Array.isArray(candidates) ? candidates : []

  if (kind === 'ipv6') {
    const filtered = list
      .map((item) => String(item || '').trim())
      .filter(Boolean)
      .filter(isLikelyPublicIpv6)

    return filtered[0] || '-'
  }

  const filtered = list
    .map((item) => String(item || '').trim())
    .filter(Boolean)

  return filtered[0] || '-'
}

function extractIpList(rawList) {
  if (!Array.isArray(rawList)) {
    return []
  }

  const values = []

  for (const item of rawList) {
    if (!item) {
      continue
    }

    if (typeof item === 'string') {
      const value = item.trim()
      if (value && !values.includes(value)) {
        values.push(value)
      }
      continue
    }

    if (typeof item === 'object') {
      const candidate =
        item.address || item.addr || item.ipaddr || item.ip || item.masked || item.value || ''
      const mask = item.mask || item.netmask || item.prefix
      const value = String(candidate || '').trim()

      if (!value) {
        continue
      }

      const withMask =
        Number.isFinite(Number(mask)) && !value.includes('/')
          ? `${value}/${Number(mask)}`
          : value

      if (!values.includes(withMask)) {
        values.push(withMask)
      }
    }
  }

  return values
}


function computeRateFromCounters(previous, current, seconds) {
  if (!Number.isFinite(previous) || !Number.isFinite(current) || current < previous || seconds <= 0) {
    return null
  }

  const deltaBytes = current - previous
  return bytesToMbps(deltaBytes / seconds)
}

function parsePercent(raw) {
  if (typeof raw === 'number' && Number.isFinite(raw)) {
    return clamp(raw, 0, 1000)
  }

  if (typeof raw !== 'string') {
    return 0
  }

  const match = raw.match(/-?\d+(?:\.\d+)?/)
  if (!match) {
    return 0
  }

  return clamp(Number(match[0]), 0, 1000)
}

function normalizeProcessEntry(entry, index = 0) {
  if (!entry || typeof entry !== 'object') {
    return null
  }

  const pidRaw = entry.pid ?? entry.PID ?? entry.process ?? entry[0]
  const pid = Number(pidRaw)
  if (!Number.isFinite(pid) || pid <= 0) {
    return null
  }

  const command =
    entry.command ??
    entry.cmd ??
    entry.COMMAND ??
    entry.name ??
    entry.exe ??
    entry[4] ??
    entry[3] ??
    '-'
  const user = entry.user ?? entry.USER ?? entry.owner ?? entry[1] ?? 'root'
  const cpu = parsePercent(entry.cpu ?? entry['%CPU'] ?? entry.cpu_percent ?? entry[2])
  const mem = parsePercent(entry.mem ?? entry['%MEM'] ?? entry.mem_percent ?? entry[3])

  return {
    id: `${pid}-${index}`,
    pid,
    user: String(user),
    cpu,
    mem,
    command: String(command).trim() || '-'
  }
}

function stripHtml(text) {
  return String(text).replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()
}

function parseProcessRowsFromHtml(html) {
  if (typeof html !== 'string') {
    return []
  }

  const rows = []

  const getCellText = (cell) => {
    if (!cell) {
      return ''
    }

    const inputValue = cell.querySelector('input[type="hidden"]')?.value
    if (typeof inputValue === 'string' && inputValue.trim()) {
      return inputValue.trim()
    }

    return cell.textContent?.replace(/\s+/g, ' ').trim() || ''
  }

  const mapProcessCells = (cells) => {
    if (!Array.isArray(cells) || cells.length < 5) {
      return null
    }

    const [pid, user, command, cpu, mem] = cells

    return {
      pid,
      user,
      command,
      cpu,
      mem
    }
  }

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const trList = Array.from(doc.querySelectorAll('tr[id^="cbi-table-"]'))

    trList.forEach((tr, rowIndex) => {
      const cells = Array.from(tr.querySelectorAll('td')).map((cell) => getCellText(cell))
      const mapped = mapProcessCells(cells)
      if (!mapped) {
        return
      }

      const normalized = normalizeProcessEntry(mapped, rowIndex)
      if (normalized) {
        rows.push(normalized)
      }
    })

    if (rows.length) {
      return rows
    }
  }

  const trMatches = html.match(/<tr[^>]*id="cbi-table-[^"]+"[\s\S]*?<\/tr>/gi) || []
  trMatches.forEach((tr, rowIndex) => {
    const valueByField = {}
    Array.from(tr.matchAll(/id="cbid\.table\.[^"]+\.([^"]+)"\s+value="([^"]*)"/gi)).forEach((match) => {
      const field = String(match[1] || '').toLowerCase()
      const value = String(match[2] || '').trim()
      if (field) {
        valueByField[field] = value
      }
    })

    const mapped = {
      pid: valueByField.pid || '',
      user: valueByField.user || '',
      command: valueByField.command || '',
      cpu: valueByField['%cpu'] || valueByField.cpu || '',
      mem: valueByField['%mem'] || valueByField.mem || ''
    }

    if (!mapped.pid || !mapped.command) {
      const tdMatches = tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []
      const cells = tdMatches.map((cell) => stripHtml(cell))
      const fallbackMapped = mapProcessCells(cells)
      if (!fallbackMapped) {
        return
      }

      const normalized = normalizeProcessEntry(fallbackMapped, rowIndex)
      if (normalized) {
        rows.push(normalized)
      }
      return
    }

    const normalized = normalizeProcessEntry(mapped, rowIndex)
    if (normalized) {
      rows.push(normalized)
    }
  })

  return rows
}

function parseProcessPayload(payload) {
  if (Array.isArray(payload)) {
    return payload
      .map((entry, index) => normalizeProcessEntry(entry, index))
      .filter(Boolean)
  }

  if (typeof payload === 'string') {
    return parseProcessRowsFromHtml(payload)
  }

  if (payload && typeof payload === 'object') {
    const directList = payload.processes || payload.data || payload.rows || payload.list
    if (Array.isArray(directList)) {
      return directList
        .map((entry, index) => normalizeProcessEntry(entry, index))
        .filter(Boolean)
    }

    const flattened = Object.values(payload)
      .flatMap((value) => parseProcessPayload(value))
      .filter(Boolean)

    if (flattened.length) {
      return flattened
    }
  }

  return []
}

function parseStartupEntriesFromHtml(html) {
  if (typeof html !== 'string') {
    return []
  }

  const rows = []

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const trList = Array.from(doc.querySelectorAll('tr[id^="cbi-table-"]'))

    trList.forEach((tr, index) => {
      const valueNodes = Array.from(tr.querySelectorAll('input[id^="cbid.table."]'))
      const valueMap = {}
      valueNodes.forEach((node) => {
        const id = node.id || ''
        const matched = id.match(/\.([^.]+)$/)
        if (matched) {
          valueMap[matched[1]] = node.value
        }
      })

      const serviceName = valueMap.name
      if (!serviceName) {
        return
      }

      const priority = Number(valueMap.index)
      const buttons = Array.from(tr.querySelectorAll('input[type="submit"]')).map((input) =>
        String(input.value || '').trim()
      )

      const enabledText = buttons.includes('禁用')
        ? '已启用'
        : buttons.includes('启用')
          ? '未启用'
          : '未知'

      rows.push({
        id: `${serviceName}-${index}`,
        name: serviceName,
        priority: Number.isFinite(priority) ? priority : 0,
        enabled: enabledText,
        actions: buttons
      })
    })

    if (rows.length) {
      return rows
    }
  }

  const trMatches = html.match(/<tr[^>]*id="cbi-table-[^"]+"[\s\S]*?<\/tr>/gi) || []
  trMatches.forEach((tr, index) => {
    const nameMatch = tr.match(/id="cbid\.table\.[^"]+\.name"\s+value="([^"]+)"/i)
    if (!nameMatch) {
      return
    }

    const indexMatch = tr.match(/id="cbid\.table\.[^"]+\.index"\s+value="([^"]+)"/i)
    const priority = Number(indexMatch?.[1] || 0)
    const buttons = Array.from(tr.matchAll(/type="submit"[^>]*value="([^"]+)"/gi)).map((match) =>
      String(match[1] || '').trim()
    )

    const enabledText = buttons.includes('禁用')
      ? '已启用'
      : buttons.includes('启用')
        ? '未启用'
        : '未知'

    rows.push({
      id: `${nameMatch[1]}-${index}`,
      name: nameMatch[1],
      priority: Number.isFinite(priority) ? priority : 0,
      enabled: enabledText,
      actions: buttons
    })
  })

  return rows
}

function parseInstalledPackageRowsFromHtml(html) {
  if (typeof html !== 'string') {
    return []
  }

  const rows = []

  if (typeof DOMParser !== 'undefined') {
    const doc = new DOMParser().parseFromString(html, 'text/html')
    const trList = Array.from(doc.querySelectorAll('table.cbi-section-table tr.cbi-section-table-row'))

    trList.forEach((tr, index) => {
      const cells = Array.from(tr.querySelectorAll('td')).map((cell) =>
        cell.textContent?.replace(/\s+/g, ' ').trim()
      )

      if (cells.length < 3) {
        return
      }

      const name = cells[1]
      const version = cells[2]

      if (!name) {
        return
      }

      rows.push({
        id: `${name}-${index}`,
        name,
        version: version || '-'
      })
    })

    if (rows.length) {
      return rows
    }
  }

  const trMatches =
    html.match(/<tr[^>]*class="[^"]*cbi-section-table-row[^"]*"[\s\S]*?<\/tr>/gi) || []

  trMatches.forEach((tr, index) => {
    const tdMatches = tr.match(/<td[^>]*>[\s\S]*?<\/td>/gi) || []
    if (tdMatches.length < 3) {
      return
    }

    const name = stripHtml(tdMatches[1])
    const version = stripHtml(tdMatches[2])

    if (!name) {
      return
    }

    rows.push({
      id: `${name}-${index}`,
      name,
      version: version || '-'
    })
  })

  return rows
}

function parsePackagePageMetaFromHtml(html) {
  if (typeof html !== 'string') {
    return {
      listHint: '',
      freeSpacePercent: '',
      freeSpacePercentValue: 0,
      freeSpaceText: ''
    }
  }

  const hintMatch = html.match(/<div class="cbi-value">\s*([\s\S]*?)<input[^>]*name="update"/i)
  const freeSpaceMatch = html.match(
    /空闲空间:\s*<strong>([^<]+)<\/strong>\s*\(<strong>([^<]+)<\/strong>\)/i
  )

  const freePercentValue = Number((freeSpaceMatch?.[1] || '').replace(/[^\d.]/g, ''))

  return {
    listHint: hintMatch ? stripHtml(hintMatch[1]) : '',
    freeSpacePercent: freeSpaceMatch?.[1]?.trim() || '',
    freeSpacePercentValue: Number.isFinite(freePercentValue) ? clamp(freePercentValue, 0, 100) : 0,
    freeSpaceText: freeSpaceMatch?.[2]?.trim() || ''
  }
}

function extractInputValueByName(html, name) {
  if (typeof html !== 'string') {
    return ''
  }

  const escaped = name.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<input[^>]*name="${escaped}"[^>]*value="([^"]*)"`, 'i'),
    new RegExp(`<input[^>]*value="([^"]*)"[^>]*name="${escaped}"`, 'i')
  ]

  for (const pattern of patterns) {
    const match = html.match(pattern)
    if (match?.[1] != null) {
      return decodeHtmlEntities(String(match[1]).trim())
    }
  }

  return ''
}

function extractSelectedOptionValue(html, selectName) {
  if (typeof html !== 'string') {
    return ''
  }

  const escaped = selectName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const selectMatch = html.match(
    new RegExp(`<select[^>]*name="${escaped}"[^>]*>([\\s\\S]*?)<\\/select>`, 'i')
  )

  if (!selectMatch) {
    return ''
  }

  const body = selectMatch[1]
  const selectedMatch =
    body.match(/<option[^>]*selected[^>]*value=["']([^"']*)["']/i) ||
    body.match(/<option[^>]*value=["']([^"']*)["'][^>]*selected/i)

  if (selectedMatch?.[1] != null) {
    return decodeHtmlEntities(String(selectedMatch[1]).trim())
  }

  const firstMatch = body.match(/<option[^>]*value=["']([^"']*)["']/i)
  return firstMatch?.[1] ? decodeHtmlEntities(String(firstMatch[1]).trim()) : ''
}

function extractDynListValues(html, prefixName) {
  if (typeof html !== 'string') {
    return []
  }

  const escaped = prefixName.replace(/[.*+?^${}()|[\]\\]/g, '\\$&')
  const patterns = [
    new RegExp(`<input[^>]*name=["']${escaped}["'][^>]*value=["']([^"']*)["']`, 'gi'),
    new RegExp(`<input[^>]*value=["']([^"']*)["'][^>]*name=["']${escaped}["']`, 'gi')
  ]

  const values = []

  for (const pattern of patterns) {
    let match = null

    while ((match = pattern.exec(html)) != null) {
      const value = decodeHtmlEntities(String(match[1] || '').trim())
      if (value && !values.includes(value)) {
        values.push(value)
      }
    }
  }

  return values
}


function parseDhcpLanIpv6MetaFromHtml(html) {
  const prefix = 'cbid.dhcp.lan'

  const isRelay = (value) => String(value || '').trim().toLowerCase() === 'relay'
  const isServer = (value) => String(value || '').trim().toLowerCase() === 'server'

  const ra = extractSelectedOptionValue(html, `${prefix}.ra`) || '-'
  const dhcpv6 = extractSelectedOptionValue(html, `${prefix}.dhcpv6`) || '-'
  const ndp = extractSelectedOptionValue(html, `${prefix}.ndp`) || '-'
  const raFlags = extractDynListValues(html, `${prefix}.ra_flags`)

  const masterValue = extractInputValueByName(html, `${prefix}.master`) || ''
  const defaultRouteValue = extractInputValueByName(html, `${prefix}.ra_default`) || ''

  return {
    designatedMaster: masterValue === '1' ? '已启用' : '未启用',
    raServiceMode: isRelay(ra) ? '中继模式' : isServer(ra) ? '服务器模式' : '已禁用',
    dhcpv6ServiceMode: isRelay(dhcpv6) ? '中继模式' : isServer(dhcpv6) ? '服务器模式' : '已禁用',
    ndpProxyMode: isRelay(ndp) ? '中继模式' : isServer(ndp) ? '服务器模式' : '已禁用',
    dhcpv6Mode: raFlags.length ? raFlags.join(' + ') : '-',
    alwaysAdvertiseDefaultRoute: defaultRouteValue === '1' ? '已启用' : '未启用',
    advertisedDnsServers: extractDynListValues(html, `${prefix}.dns`),
    advertisedDnsDomains: extractDynListValues(html, `${prefix}.domain`)
  }
}

function parseAdGuardHomeMetaFromHtml(html) {
  const prefix = 'cbid.AdGuardHome.AdGuardHome'

  return {
    enabled: extractInputValueByName(html, `${prefix}.enabled`) === '1',
    httpPort: extractInputValueByName(html, `${prefix}.httpport`) || '-',
    redirectMode: extractSelectedOptionValue(html, `${prefix}.redirect`) || '-',
    binPath: extractInputValueByName(html, `${prefix}.binpath`) || '-',
    configPath: extractInputValueByName(html, `${prefix}.configpath`) || '-',
    workDir: extractInputValueByName(html, `${prefix}.workdir`) || '-',
    logFile: extractInputValueByName(html, `${prefix}.logfile`) || '-',
    verbose: extractInputValueByName(html, `${prefix}.verbose`) === '1',
    waitOnBoot: extractInputValueByName(html, `${prefix}.waitonboot`) === '1',
    backupFiles: extractDynListValues(html, `${prefix}.backupfile`),
    backupWorkDirPath: extractInputValueByName(html, `${prefix}.backupwdpath`) || '-',
    coreVersion: (() => {
      const match = typeof html === 'string' ? html.match(/核心版本:\s*<strong><font[^>]*>([^<]+)<\/font><\/strong>/i) : null
      return match?.[1] ? decodeHtmlEntities(String(match[1]).trim()) : '-'
    })()
  }
}

function findFirstDdnsGoSectionName(html) {
  if (typeof html !== 'string') {
    return 'cfg018967'
  }

  const match = html.match(/name=["']cbid\.ddns-go\.([^.]+)\.enabled["']/i)
  return match?.[1] ? String(match[1]).trim() : 'cfg018967'
}

function parseDdnsGoMetaFromHtml(html) {
  const section = findFirstDdnsGoSectionName(html)
  const prefix = `cbid.ddns-go.${section}`

  return {
    section,
    enabled: extractInputValueByName(html, `${prefix}.enabled`) === '1',
    port: extractInputValueByName(html, `${prefix}.port`) || '-',
    updateInterval: extractInputValueByName(html, `${prefix}.time`) || '-',
    compareTimes: extractInputValueByName(html, `${prefix}.ctimes`) || '-',
    skipVerify: extractInputValueByName(html, `${prefix}.skipverify`) === '1',
    dnsServer: extractInputValueByName(html, `${prefix}.dns`) || '-',
    noWeb: extractInputValueByName(html, `${prefix}.noweb`) === '1',
    delay: extractInputValueByName(html, `${prefix}.delay`) || '-',
    description: (() => {
      const match = typeof html === 'string'
        ? html.match(/<div class=["']cbi-map-descr["']>([\s\S]*?)<\/div>/i)
        : null
      return match?.[1] ? stripHtml(match[1]).trim() : ''
    })()
  }
}



function parseOpenClashSettingsFromHtml(html) {
  const prefix = 'cbid.openclash.config'

  return {
    dashboardPort: extractInputValueByName(html, `${prefix}.cn_port`) || '-',
    dashboardSecret: extractInputValueByName(html, `${prefix}.dashboard_password`) || '',
    dashboardForwardDomain: extractInputValueByName(html, `${prefix}.dashboard_forward_domain`) || '',
    dashboardForwardPort: extractInputValueByName(html, `${prefix}.dashboard_forward_port`) || '',
    dashboardForwardSsl: extractInputValueByName(html, `${prefix}.dashboard_forward_ssl`) === '1'
  }
}


function parseNetworkInterfaceMetaFromHtml(html, iface) {
  const prefix = `cbid.network.${iface}`

  return {
    protocol: extractSelectedOptionValue(html, `${prefix}.proto`) || '-',
    ipv4: extractInputValueByName(html, `${prefix}.ipaddr`) || '-',
    netmask: extractInputValueByName(html, `${prefix}.netmask`) || '-',
    gateway: extractInputValueByName(html, `${prefix}.gateway`) || '-',
    dns: extractDynListValues(html, `${prefix}.dns`),
    ipv6assign: extractInputValueByName(html, `${prefix}.ip6assign`) || '-',
    pppoeUsername: extractInputValueByName(html, `${prefix}.username`) || '-',
    pppoePasswordMasked: extractInputValueByName(html, `${prefix}.password`) ? '******' : '-',
    mtu: extractInputValueByName(html, `${prefix}.mtu`) || '-'
  }
}

async function callUbus(object, method, data = {}) {
  if (!runtimeUbusAvailable) {
    throw new Error('ubus unavailable: access denied')
  }

  const payload = await fetchMaybeJson('/ubus', {
    method: 'POST',
    headers: {
      'Content-Type': 'application/json'
    },
    body: JSON.stringify({
      jsonrpc: '2.0',
      id: Date.now(),
      method: 'call',
      params: [runtimeUbusSession, object, method, data]
    })
  })

  if (payload?.error) {
    if (Number(payload.error.code) === -32002) {
      runtimeUbusAvailable = false
      throw new Error('ubus access denied')
    }
    throw new Error(`ubus error: ${payload.error.code}`)
  }

  if (!Array.isArray(payload?.result) || payload.result[0] !== 0) {
    const ubusCode = Array.isArray(payload?.result) ? Number(payload.result[0]) : NaN
    if (ubusCode === 6) {
      runtimeUbusAvailable = false
      throw new Error('ubus access denied')
    }
    throw new Error('ubus result failed')
  }

  runtimeUbusAvailable = true
  return payload.result[1] || {}
}

export function getRouterAuthState() {
  return {
    authenticated: runtimeUbusSession !== UBUS_SESSION,
    luciAuthenticated: runtimeLuciAuthenticated,
    token: runtimeUbusSession,
    address: `${runtimeRouterScheme}://${runtimeRouterAddress}`
  }
}

export function resetRouterAuth() {
  runtimeUbusSession = UBUS_SESSION
  runtimeLuciAuthenticated = false
  runtimeLuciStok = ''
  previousIfaceTrafficSample = null
  runtimeBoardInfoCache = null
  runtimeCpuModelCache = null
  runtimeCpuModelProbeAttempted = false
  runtimeOverviewPageMetaCache = null
  runtimeUbusAvailable = true
}

export function setRouterAddress(address) {
  const normalized = normalizeRouterAddress(address)

  if (!normalized.valid) {
    throw new Error('路由器地址格式无效，请输入 192.168.1.1 或 http://192.168.1.1')
  }

  const changed =
    normalized.address !== runtimeRouterAddress || normalized.scheme !== runtimeRouterScheme
  runtimeRouterAddress = normalized.address
  runtimeRouterScheme = normalized.scheme

  if (changed) {
    runtimeUbusSession = UBUS_SESSION
    runtimeLuciAuthenticated = false
    runtimeLuciStok = ''
    previousCounterSample = null
    previousIfaceTrafficSample = null
    runtimeBoardInfoCache = null
    runtimeCpuModelCache = null
    runtimeCpuModelProbeAttempted = false
    runtimeOverviewPageMetaCache = null
    runtimeUbusAvailable = true
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
      params: [UBUS_SESSION, 'session', 'login', { username, password }]
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
  runtimeUbusAvailable = true
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

  if (location.includes('192.168.1.1') && runtimeRouterAddress !== '192.168.1.1') {
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

export async function diagnoseRouterConnection(options = {}) {
  const username = String(options.username || '').trim()
  const password = String(options.password || '').trim()
  const checks = []

  const pushCheck = (name, ok, message) => {
    checks.push({
      name,
      ok,
      message
    })
  }

  try {
    const ubusLogin = await performRequest('/ubus', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'call',
        params: [UBUS_SESSION, 'session', 'login', { username: 'root', password: '__invalid__' }]
      })
    })

    if (!ubusLogin.response.ok) {
      pushCheck('ubus 接口可达性', false, `HTTP ${ubusLogin.response.status}`)
    } else if (ubusLogin.body?.error) {
      pushCheck('ubus 接口可达性', false, `RPC error ${ubusLogin.body.error.code}`)
    } else {
      pushCheck('ubus 接口可达性', true, '可访问（返回正常）')
    }
  } catch (error) {
    pushCheck('ubus 接口可达性', false, error?.message || '请求失败')
  }

  try {
    const luci = await performRequest('/cgi-bin/luci')
    if (!luci.response.ok) {
      pushCheck('LuCI 页面可达性', false, `HTTP ${luci.response.status}`)
    } else {
      pushCheck('LuCI 页面可达性', true, '页面可访问')
    }
  } catch (error) {
    pushCheck('LuCI 页面可达性', false, error?.message || '请求失败')
  }

  if (username && password) {
    try {
      const loginState = await loginRouter(username, password)
      if (loginState.luciAuthenticated) {
        pushCheck('LuCI 登录状态', true, `已登录${loginState.warning ? `（${loginState.warning}）` : ''}`)
      } else {
        pushCheck('LuCI 登录状态', false, loginState.warning || '已登录 ubus，但 LuCI 会话未建立')
      }
    } catch (error) {
      pushCheck('LuCI 登录状态', false, error?.message || '登录失败')
    }
  } else {
    pushCheck('LuCI 登录状态', false, '未提供用户名/密码，未执行登录测试')
  }

  try {
    await fetchRealtimeConnections()
    pushCheck('Realtime 连接数', true, '可读取')
  } catch (error) {
    pushCheck('Realtime 连接数', false, error?.message || '读取失败')
  }

  try {
    await fetchRealtimeBandwidth()
    pushCheck('Realtime 流量', true, '可读取')
  } catch (error) {
    pushCheck('Realtime 流量', false, error?.message || '读取失败')
  }

  try {
    await fetchTopProcesses(3)
    pushCheck('Processes 页面', true, '可读取')
  } catch (error) {
    pushCheck('Processes 页面', false, error?.message || '读取失败')
  }

  return {
    checks,
    passed: checks.filter((item) => item.ok).length,
    total: checks.length,
    sampledAt: Date.now()
  }
}

export function getRouterDefaults() {
  const envAddress = String(import.meta.env.VITE_ROUTER_ADDRESS || '').trim()
  const envPassword = String(import.meta.env.VITE_ROUTER_PASSWORD || '')
  const normalizedAddress = normalizeRouterAddress(envAddress)
  const hasCredential = Boolean(envPassword)

  return {
    address: normalizedAddress.valid
      ? `${normalizedAddress.scheme}://${normalizedAddress.address}`
      : `${DEFAULT_ROUTER_SCHEME}://${DEFAULT_ROUTER_ADDRESS}`,
    password: envPassword,
    autoLogin: parseBooleanEnv(import.meta.env.VITE_ROUTER_AUTO_LOGIN, hasCredential)
  }
}

export async function fetchRealtimeConnections() {
  const payload = await fetchMaybeJson(resolveLuciPath(REALTIME_CONNECTIONS_PATH))
  const value = parseConnectionsPayload(payload)

  return {
    value,
    sampledAt: Date.now()
  }
}

export async function fetchRealtimeBandwidth() {
  const payload = await fetchMaybeJson(resolveLuciPath(REALTIME_BANDWIDTH_PATH))
  const parsed = parseBandwidthPayload(payload)

  return {
    ...parsed,
    sampledAt: Date.now()
  }
}

export async function fetchSystemSnapshot(cpuCoresGuess = 4) {
  const [board, info] = await Promise.all([callUbus('system', 'board'), callUbus('system', 'info')])

  const cpuModel = board.model || board.system || board.board_name || '未知 CPU'

  let cpuLoadPercent = null
  if (Array.isArray(info.load) && info.load.length) {
    const oneMinuteLoad = Number(info.load[0]) / 65535
    cpuLoadPercent = clamp(Math.round((oneMinuteLoad / cpuCoresGuess) * 100), 0, 100)
  }

  let memoryPercent = null
  let memoryText = null
  if (info.memory?.total) {
    const used = Math.max(0, Number(info.memory.total) - Number(info.memory.free || 0))
    memoryPercent = clamp(Math.round((used / Number(info.memory.total)) * 100), 0, 100)
    memoryText = `${formatBytes(used)} / ${formatBytes(Number(info.memory.total))}`
  }

  return {
    cpuModel,
    cpuLoadPercent,
    memoryPercent,
    memoryText
  }
}

/**
 * Data source: HTML (LuCI `/admin/status/processes`)
 */
export async function fetchTopProcesses() {
  const payload = await fetchMaybeJson(resolveLuciPath(PROCESSES_PATH))
  const parsed = parseProcessPayload(payload)

  if (!parsed.length) {
    throw new Error('无法解析进程列表')
  }

  const sorted = [...parsed]
    .sort((a, b) => {
      if (b.cpu !== a.cpu) {
        return b.cpu - a.cpu
      }

      if (b.mem !== a.mem) {
        return b.mem - a.mem
      }

      return a.pid - b.pid
    })

  return {
    items: sorted,
    sampledAt: Date.now()
  }
}



function normalizeInterfaceStatusFromIfaceStatus(target, iface) {
  return {
    id: target?.id || iface,
    name: target?.name || iface,
    ifname: target?.ifname || '-',
    isUp: Boolean(target?.is_up),
    rxBytes: Number(target?.rx_bytes) || 0,
    txBytes: Number(target?.tx_bytes) || 0,
    rxPackets: Number(target?.rx_packets) || 0,
    txPackets: Number(target?.tx_packets) || 0,
    uptime: Number(target?.uptime) || 0,
    proto: target?.proto || '',
    ip4addrs: extractIpList(target?.ipaddrs || target?.ipv4_addresses || target?.ipv4),
    ip6addrs: extractIpList(target?.ip6addrs || target?.ipv6_addresses || target?.ipv6),
    ip6prefix: target?.ip6prefix ? String(target.ip6prefix) : '',
    sampledAt: Date.now()
  }
}

function normalizeInterfaceStatusFromUbus(target, iface) {
  return {
    id: iface,
    name: iface,
    ifname: target?.l3_device || target?.device || iface,
    isUp: Boolean(target?.up),
    rxBytes: Number(target?.statistics?.rx_bytes) || 0,
    txBytes: Number(target?.statistics?.tx_bytes) || 0,
    rxPackets: Number(target?.statistics?.rx_packets) || 0,
    txPackets: Number(target?.statistics?.tx_packets) || 0,
    uptime: Number(target?.uptime) || 0,
    proto: String(target?.proto || ''),
    ip4addrs: extractIpList(target?.['ipv4-address']),
    ip6addrs: extractIpList(target?.['ipv6-address']),
    ip6prefix: Array.isArray(target?.['ipv6-prefix']) && target['ipv6-prefix'][0]?.address
      ? String(target['ipv6-prefix'][0].address)
      : '',
    sampledAt: Date.now()
  }
}

function parseDdnsGoConfigFromUci(payload) {
  const values = payload?.values && typeof payload.values === 'object' ? payload.values : payload || {}
  const enabledValue = String(values.enable ?? values.enabled ?? '').trim()
  const skipVerifyValue = String(values.skip_verify ?? values.skipverify ?? '').trim()
  const noWebValue = String(values.noweb ?? values.no_web ?? '').trim()

  return {
    enabled: enabledValue === '1' || enabledValue.toLowerCase() === 'true',
    port: String(values.port || '-'),
    updateInterval: String(values.time || values.interval || '-'),
    compareTimes: String(values.ctimes || '-'),
    skipVerify: skipVerifyValue === '1' || skipVerifyValue.toLowerCase() === 'true',
    dnsServer: String(values.dns || '-'),
    noWeb: noWebValue === '1' || noWebValue.toLowerCase() === 'true',
    delay: String(values.delay || '0'),
    description: ''
  }
}

function parseAdGuardHomeConfigFromUci(payload) {
  const values = payload?.values && typeof payload.values === 'object' ? payload.values : payload || {}
  const enabledValue = String(values.enabled ?? values.enable ?? '').trim()
  const verboseValue = String(values.verbose ?? '').trim()
  const waitOnBootValue = String(values.waitonboot ?? values.restartonboot ?? '').trim()

  return {
    enabled: enabledValue === '1' || enabledValue.toLowerCase() === 'true',
    httpPort: String(values.httpport || values.port || '-'),
    redirectMode: String(values.redirect || '-'),
    binPath: String(values.binpath || '/usr/bin/AdGuardHome/AdGuardHome'),
    configPath: String(values.configpath || '/etc/AdGuardHome.yaml'),
    workDir: String(values.workdir || '/usr/bin/AdGuardHome'),
    logFile: String(values.logfile || '/tmp/AdGuardHome.log'),
    verbose: verboseValue === '1' || verboseValue.toLowerCase() === 'true',
    waitOnBoot: waitOnBootValue === '1' || waitOnBootValue.toLowerCase() === 'true',
    backupFiles: Array.isArray(values.backupfile)
      ? values.backupfile
      : typeof values.backupfile === 'string' && values.backupfile.trim()
        ? values.backupfile.split(/[\s,\/]+/).filter(Boolean)
        : [],
    backupWorkDirPath: String(values.backupwdpath || values.workdir || '/usr/bin/AdGuardHome'),
    coreVersion: '-'
  }
}

/**
 * Data source: LuCI JSON (`/admin/status/overview?status=1`) + UBUS (`system.board`)
 */
export async function fetchOverviewStatus() {
  const payload = await fetchMaybeJson(resolveLuciPath(OVERVIEW_STATUS_PATH))

  if (!payload || typeof payload !== 'object') {
    throw new Error('overview 数据格式无效')
  }

  const memory = payload.memory || {}
  const memoryTotal = Number(memory.total) || 0
  const memoryAvailable = Number(memory.available) || Number(memory.free) || 0
  const memoryUsed = Math.max(0, memoryTotal - memoryAvailable)
  const memoryPercent =
    memoryTotal > 0 ? clamp(Math.round((memoryUsed / memoryTotal) * 100), 0, 100) : null

  const cpuPercent = parseCpuUsagePercent(payload.cpuusage)
  const loadArray = Array.isArray(payload.loadavg) ? payload.loadavg : []
  const loadOne = parseLoadAverage(loadArray[0])
  const loadFive = parseLoadAverage(loadArray[1])
  const loadFifteen = parseLoadAverage(loadArray[2])

  const leaseItems = Array.isArray(payload.leases)
    ? payload.leases.map((item, index) => normalizeLeaseItem(item, index)).filter(Boolean)
    : []
  const lease6Items = Array.isArray(payload.leases6)
    ? payload.leases6.map((item, index) => normalizeLease6Item(item, index)).filter(Boolean)
    : []

  const ethInfo = parseEthInfo(payload.ethinfo)
  const lanPort = ethInfo.find((item) => String(item.name || '').toLowerCase().includes('eth1')) || ethInfo[0]
  const lanSpeedMbps = parsePortSpeed(String(lanPort?.speed || ''))

  const rates = normalizeOverviewRates(payload)
  const boardInfo = await readBoardInfoCached()
  const overviewPageMeta = await readOverviewPageMetaCached()

  let parsedCpuModel =
    parseCpuModel(payload.cpuinfo) ||
    parseCpuModel(boardInfo?.model) ||
    parseCpuModel(boardInfo?.system) ||
    runtimeCpuModelCache

  if (!parsedCpuModel && !runtimeCpuModelProbeAttempted) {
    runtimeCpuModelProbeAttempted = true
    const detectedCpuModel = await detectCpuModelFromProcCpuinfo()
    if (detectedCpuModel) {
      parsedCpuModel = detectedCpuModel
      runtimeCpuModelCache = detectedCpuModel
    }
  }

  if (parsedCpuModel) {
    runtimeCpuModelCache = parsedCpuModel
  }

  const parsedOpenWrtVersion = parseOpenWrtVersion(payload) || parseOpenWrtVersion(boardInfo)
  const parsedHostModel =
    parseHostModel(payload) ||
    parseHostModel(boardInfo) ||
    overviewPageMeta?.hostModel ||
    overviewPageMeta?.hostName
  const parsedCpuCores = parseCpuCores(
    payload?.cpucores,
    payload?.cpu_cores,
    boardInfo?.cpu?.count,
    boardInfo?.cpu_count,
    parsedHostModel,
    parsedCpuModel
  )
  const parsedFirmwareVersion = overviewPageMeta?.firmwareVersion || null
  const parsedKernelVersion = overviewPageMeta?.kernelVersion || null

  return {
    sampledAt: Date.now(),
    conncount: Number(payload.conncount) || 0,
    connmax: Number(payload.connmax) || 0,
    cpuModel: parsedCpuModel,
    openwrtVersion: parsedFirmwareVersion || parsedOpenWrtVersion,
    hostModel: parsedHostModel,
    hostName: overviewPageMeta?.hostName || null,
    firmwareVersion: parsedFirmwareVersion,
    kernelVersion: parsedKernelVersion,
    cpuCores: parsedCpuCores,
    cpuPercent,
    loadOne,
    loadFive,
    loadFifteen,
    memoryPercent,
    memoryText:
      memoryTotal > 0 ? `${formatBytes(memoryUsed)} / ${formatBytes(memoryTotal)}` : null,
    wan: {
      proto: payload.wan?.proto || '-',
      ipaddr: payload.wan?.ipaddr || '-',
      gateway: payload.wan?.gwaddr || '-',
      uptime: Number(payload.wan?.uptime) || 0,
      dns: Array.isArray(payload.wan?.dns) ? payload.wan.dns : []
    },
    leaseCount: leaseItems.length,
    leases: leaseItems,
    lease6Count: lease6Items.length,
    leases6: lease6Items,
    lan: {
      name: lanPort?.name || '-',
      speedMbps: lanSpeedMbps,
      duplex: Number(lanPort?.duplex) || 0,
      status: Number(lanPort?.status) || 0
    },
    wanDownMbps: rates.wanDownMbps,
    wanUpMbps: rates.wanUpMbps,
    localtime: payload.localtime || '',
    uptime: Number(payload.uptime) || 0
  }
}

/**
 * Data source: UBUS preferred (`network.interface.wan/wan6 status`), fallback LuCI iface_status
 */
export async function fetchIfaceTrafficRates() {
  let wanStatus = null
  let wan6Status = null

  try {
    ;[wanStatus, wan6Status] = await Promise.all([
      callUbus('network.interface.wan', 'status').catch(() => null),
      callUbus('network.interface.wan6', 'status').catch(() => null)
    ])
  } catch (error) {
    if (!isAccessDeniedError(error)) {
      throw error
    }
  }

  if (!wanStatus && !wan6Status) {
    logUbusFallback('fetchIfaceTrafficRates', 'network.interface access denied, fallback to /admin/network/iface_status')
    const payload = await fetchMaybeJson(resolveLuciPath(IFACE_STATUS_PATH))

    if (!Array.isArray(payload)) {
      throw new Error('iface_status 返回格式无效')
    }

    const wan = findInterfaceById(payload, 'wan')
    const wan6 = findInterfaceById(payload, 'wan6')

    if (!wan && !wan6) {
      throw new Error('未找到 wan/wan6 接口')
    }

    wanStatus = {
      statistics: {
        rx_bytes: Number(wan?.rx_bytes) || 0,
        tx_bytes: Number(wan?.tx_bytes) || 0
      }
    }
    wan6Status = {
      statistics: {
        rx_bytes: Number(wan6?.rx_bytes) || 0,
        tx_bytes: Number(wan6?.tx_bytes) || 0
      }
    }
  }

  const now = Date.now()
  const sample = {
    ts: now,
    wanRx: Number(wanStatus?.statistics?.rx_bytes) || 0,
    wanTx: Number(wanStatus?.statistics?.tx_bytes) || 0,
    wan6Rx: Number(wan6Status?.statistics?.rx_bytes) || 0,
    wan6Tx: Number(wan6Status?.statistics?.tx_bytes) || 0
  }

  if (!previousIfaceTrafficSample) {
    previousIfaceTrafficSample = sample
    return {
      wanDownMbps: 0,
      wanUpMbps: 0,
      wan6DownMbps: 0,
      wan6UpMbps: 0,
      sampledAt: now
    }
  }

  const seconds = Math.max(1, (now - previousIfaceTrafficSample.ts) / 1000)

  const wanDown = computeRateFromCounters(previousIfaceTrafficSample.wanRx, sample.wanRx, seconds)
  const wanUp = computeRateFromCounters(previousIfaceTrafficSample.wanTx, sample.wanTx, seconds)
  const wan6Down = computeRateFromCounters(previousIfaceTrafficSample.wan6Rx, sample.wan6Rx, seconds)
  const wan6Up = computeRateFromCounters(previousIfaceTrafficSample.wan6Tx, sample.wan6Tx, seconds)

  previousIfaceTrafficSample = sample

  return {
    wanDownMbps: clamp(Number(wanDown || 0), 0, 5000),
    wanUpMbps: clamp(Number(wanUp || 0), 0, 5000),
    wan6DownMbps: clamp(Number(wan6Down || 0), 0, 5000),
    wan6UpMbps: clamp(Number(wan6Up || 0), 0, 5000),
    sampledAt: now
  }
}

/**
 * Data source: UBUS preferred (`rc list`), fallback HTML (`/admin/system/startup`)
 */
export async function fetchStartupEntries(limit = 30) {
  try {
    const payload = await callUbus('rc', 'list', {})
    const inits = payload?.inits && typeof payload.inits === 'object' ? payload.inits : {}

    const entries = Object.keys(inits).map((name, index) => {
      const item = inits[name] || {}
      return {
        id: `${name}-${index}`,
        name,
        priority: Number(item.start ?? item.index ?? 0) || 0,
        enabled: item.enabled ? '已启用' : '未启用',
        script: String(item.script || `/etc/init.d/${name}`)
      }
    })

    const sorted = entries
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority
        }
        return a.name.localeCompare(b.name)
      })
      .slice(0, limit)

    return {
      items: sorted,
      sampledAt: Date.now()
    }
  } catch (error) {
    if (!isAccessDeniedError(error)) {
      throw error
    }

    logUbusFallback('fetchStartupEntries', 'rc.list access denied, fallback to /admin/system/startup HTML')
    const payload = await fetchMaybeJson(resolveLuciPath(STARTUP_PATH))
    const entries = parseStartupEntriesFromHtml(payload)

    if (!entries.length) {
      throw new Error('无法解析启动项列表')
    }

    const sorted = [...entries]
      .sort((a, b) => {
        if (a.priority !== b.priority) {
          return a.priority - b.priority
        }

        return a.name.localeCompare(b.name)
      })
      .slice(0, limit)

    return {
      items: sorted,
      sampledAt: Date.now()
    }
  }
}

/**
 * Data source: UBUS preferred (`file.exec` + `opkg list-installed`), fallback HTML packages page
 */
export async function fetchInstalledPackages(limit = 2000) {
  const payload = await callUbus('file', 'exec', {
    command: '/bin/sh',
    params: ['-c', 'opkg list-installed 2>/dev/null || opkg list-installed']
  })

  const stdout = String(payload?.stdout || '')
  const lines = stdout
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean)

  const items = lines.map((line, index) => {
    const dashIndex = line.indexOf(' - ')
    if (dashIndex <= 0) {
      return null
    }

    const name = line.slice(0, dashIndex).trim()
    const version = line.slice(dashIndex + 3).trim()
    if (!name) {
      return null
    }

    return {
      id: `${name}-${index}`,
      name,
      version: version || '-'
    }
  }).filter(Boolean)

  if (!items.length) {
    throw new Error('无法解析已安装软件包列表')
  }

  const sorted = [...items]
    .sort((a, b) => a.name.localeCompare(b.name, 'zh-Hans-CN', { numeric: true }))
    .slice(0, limit)

  return {
    listHint: '来自 opkg list-installed',
    freeSpacePercent: '',
    freeSpacePercentValue: 0,
    freeSpaceText: '',
    total: items.length,
    truncated: items.length > limit,
    items: sorted,
    sampledAt: Date.now()
  }
}

/**
 * Data source: UBUS preferred (`system.info`), fallback HTML packages page
 */
export async function fetchPackagesStorageMeta() {
  try {
    const info = await callUbus('system', 'info')
    const root = info?.root && typeof info.root === 'object' ? info.root : {}

    const total = Number(root.total) || 0
    const free = Number(root.free) || 0
    const freeSpacePercentValue = total > 0 ? clamp(Math.round((free / total) * 100), 0, 100) : 0

    return {
      listHint: '来自 system.info.root',
      freeSpacePercent: `${freeSpacePercentValue}%`,
      freeSpacePercentValue,
      freeSpaceText: `${formatBytes(free * 1024)} / ${formatBytes(total * 1024)}`,
      sampledAt: Date.now()
    }
  } catch (error) {
    if (!isAccessDeniedError(error)) {
      throw error
    }

    logUbusFallback('fetchPackagesStorageMeta', 'system.info access denied, fallback to packages HTML meta')
    const payload = await fetchMaybeJson(resolveLuciPath(PACKAGES_PATH))
    const meta = parsePackagePageMetaFromHtml(payload)

    return {
      ...meta,
      sampledAt: Date.now()
    }
  }
}

/**
 * Data source: UBUS preferred (`uci get network.lan`), fallback HTML network/lan
 */
export async function fetchNetworkLanConfig() {
  try {
    const payload = await callUbus('uci', 'get', {
      config: 'network',
      section: 'lan'
    })

    const values = payload?.values && typeof payload.values === 'object' ? payload.values : {}

    return {
      protocol: String(values.proto || '-'),
      ipv4: String(values.ipaddr || '-'),
      netmask: String(values.netmask || '-'),
      gateway: String(values.gateway || '-'),
      dns: Array.isArray(values.dns)
        ? values.dns.map((item) => String(item || '').trim()).filter(Boolean)
        : typeof values.dns === 'string' && values.dns.trim()
          ? values.dns.split(/[\s,]+/).filter(Boolean)
          : [],
      ipv6assign: String(values.ip6assign || '-'),
      pppoeUsername: '-',
      pppoePasswordMasked: '-',
      mtu: String(values.mtu || '-'),
      sampledAt: Date.now()
    }
  } catch (error) {
    if (!isAccessDeniedError(error)) {
      throw error
    }

    logUbusFallback('fetchNetworkLanConfig', 'uci.get network.lan access denied, fallback to network/lan HTML')
    const payload = await fetchMaybeJson(resolveLuciPath(NETWORK_LAN_PATH))
    const parsed = parseNetworkInterfaceMetaFromHtml(payload, 'lan')

    return {
      ...parsed,
      sampledAt: Date.now()
    }
  }
}

/**
 * Data source: UBUS preferred (`network.interface.<iface> status`), fallback LuCI iface_status
 */
export async function fetchInterfaceStatusByName(ifaceName) {
  const iface = String(ifaceName || '').trim()

  if (!iface) {
    throw new Error('接口名称不能为空')
  }

  try {
    const payload = await callUbus(`network.interface.${iface}`, 'status')
    return normalizeInterfaceStatusFromUbus(payload, iface)
  } catch (error) {
    if (!isAccessDeniedError(error)) {
      throw error
    }

    logUbusFallback('fetchInterfaceStatusByName', `network.interface.${iface} access denied, fallback to iface_status`)
    const payload = await fetchMaybeJson(resolveLuciPath(`/admin/network/iface_status/${encodeURIComponent(iface)}`))

    if (!Array.isArray(payload) || payload.length === 0) {
      throw new Error(`未找到接口状态：${iface}`)
    }

    const target = findInterfaceById(payload, iface) || payload[0]
    return normalizeInterfaceStatusFromIfaceStatus(target, iface)
  }
}

/**
 * Data source: UBUS preferred (`network.interface.<iface> status`), fallback LuCI iface_status
 */
export async function fetchInterfaceStatusBatch(ifaceNames = []) {
  const names = Array.from(
    new Set(
      (Array.isArray(ifaceNames) ? ifaceNames : [])
        .map((item) => String(item || '').trim())
        .filter(Boolean)
    )
  )

  if (!names.length) {
    return []
  }

  try {
    const statuses = await Promise.all(
      names.map((iface) =>
        callUbus(`network.interface.${iface}`, 'status')
          .then((payload) => normalizeInterfaceStatusFromUbus(payload, iface))
          .catch(() => null)
      )
    )

    const filtered = statuses.filter(Boolean)
    if (filtered.length) {
      return filtered
    }
  } catch (error) {
    if (!isAccessDeniedError(error)) {
      throw error
    }
  }

  logUbusFallback('fetchInterfaceStatusBatch', 'network.interface.* access denied, fallback to iface_status batch')
  const payload = await fetchMaybeJson(resolveLuciPath(`/admin/network/iface_status/${names.join(',')}`))

  if (!Array.isArray(payload)) {
    throw new Error('iface_status 返回格式无效')
  }

  return names
    .map((iface) => {
      const target = findInterfaceById(payload, iface)
      if (!target) {
        return null
      }
      return normalizeInterfaceStatusFromIfaceStatus(target, iface)
    })
    .filter(Boolean)
}

/**
 * Data source: LuCI JSON (`/admin/services/openclash/toolbar_show`)
 */
export async function fetchOpenClashToolbarStatus() {
  const payload = await fetchMaybeJson(resolveLuciPath(`${OPENCLASH_TOOLBAR_PATH}?_=${Math.random()}`))

  if (!payload || typeof payload !== 'object') {
    throw new Error('OpenClash toolbar 返回格式无效')
  }

  const downRateMbps = clamp(parseOpenClashRateText(payload.down), 0, 100000)
  const upRateMbps = clamp(parseOpenClashRateText(payload.up), 0, 100000)

  return {
    downRateMbps,
    upRateMbps,
    downRaw: String(payload.down || ''),
    upRaw: String(payload.up || ''),
    downTotal: String(payload.down_total || '-'),
    upTotal: String(payload.up_total || '-'),
    connections: Number(payload.connections) || 0,
    loadAvg: String(payload.load_avg || '-'),
    mem: String(payload.mem || '-'),
    cpu: String(payload.cpu || '-'),
    sampledAt: Date.now()
  }
}


/**
 * Data source: UBUS preferred (`uci get openclash.config`), fallback HTML openclash settings
 */
export async function fetchOpenClashSettings() {
  try {
    const payload = await callUbus('uci', 'get', {
      config: 'openclash',
      section: 'config'
    })

    const values = payload?.values && typeof payload.values === 'object' ? payload.values : {}
    const ssl = String(values.dashboard_forward_ssl ?? '').trim().toLowerCase()

    return {
      dashboardPort: String(values.cn_port || '-'),
      dashboardSecret: String(values.dashboard_password || ''),
      dashboardForwardDomain: String(values.dashboard_forward_domain || ''),
      dashboardForwardPort: String(values.dashboard_forward_port || ''),
      dashboardForwardSsl: ssl === '1' || ssl === 'true' || ssl === 'yes' || ssl === 'on',
      sampledAt: Date.now()
    }
  } catch (error) {
    if (!isAccessDeniedError(error)) {
      throw error
    }

    logUbusFallback('fetchOpenClashSettings', 'uci.get openclash.config access denied, fallback to openclash/settings HTML')
    const payload = await fetchMaybeJson(resolveLuciPath(OPENCLASH_SETTINGS_PATH))
    const parsed = parseOpenClashSettingsFromHtml(payload)

    return {
      ...parsed,
      sampledAt: Date.now()
    }
  }
}

/**
 * Data source: UBUS preferred (`network.interface.lan/wan/wan6 status`), fallback LuCI iface_status
 */
export async function fetchPublicNetworkAddresses() {
  try {
    const [lan, wan, wan6] = await Promise.all([
      callUbus('network.interface.lan', 'status').catch(() => null),
      callUbus('network.interface.wan', 'status').catch(() => null),
      callUbus('network.interface.wan6', 'status').catch(() => null)
    ])

    const ipv4Candidates = [
      ...extractIpList(wan?.['ipv4-address']),
      ...extractIpList(lan?.['ipv4-address'])
    ]

    const ipv6Candidates = [
      ...extractIpList(wan6?.['ipv6-address']),
      ...extractIpList(wan?.['ipv6-address']),
      ...extractIpList(lan?.['ipv6-address'])
    ]

    return {
      ipv4: pickPrimaryPublicIp(ipv4Candidates, 'ipv4'),
      ipv6: pickPrimaryPublicIp(ipv6Candidates, 'ipv6'),
      sampledAt: Date.now()
    }
  } catch (error) {
    if (!isAccessDeniedError(error)) {
      throw error
    }

    logUbusFallback('fetchPublicNetworkAddresses', 'network.interface.* access denied, fallback to iface_status')
    const payload = await fetchMaybeJson(resolveLuciPath('/admin/network/iface_status/lan,wan,wan6'))

    if (!Array.isArray(payload)) {
      throw new Error('公网地址接口返回格式无效')
    }

    const lan = findInterfaceById(payload, 'lan')
    const wan = findInterfaceById(payload, 'wan')
    const wan6 = findInterfaceById(payload, 'wan6')

    const ipv4Candidates = [
      ...extractIpList(wan?.ipaddrs || wan?.ipv4_addresses || wan?.ipv4),
      ...extractIpList(lan?.ipaddrs || lan?.ipv4_addresses || lan?.ipv4)
    ]

    const ipv6Candidates = [
      ...extractIpList(wan6?.ip6addrs || wan6?.ipv6_addresses || wan6?.ipv6),
      ...extractIpList(wan?.ip6addrs || wan?.ipv6_addresses || wan?.ipv6),
      ...extractIpList(lan?.ip6addrs || lan?.ipv6_addresses || lan?.ipv6)
    ]

    return {
      ipv4: pickPrimaryPublicIp(ipv4Candidates, 'ipv4'),
      ipv6: pickPrimaryPublicIp(ipv6Candidates, 'ipv6'),
      sampledAt: Date.now()
    }
  }
}

/**
 * Data source: UBUS preferred (`uci get dhcp.lan`), fallback HTML network/dhcp
 */
export async function fetchDhcpLanIpv6Config() {
  try {
    const payload = await callUbus('uci', 'get', {
      config: 'dhcp',
      section: 'lan'
    })

    const values = payload?.values && typeof payload.values === 'object' ? payload.values : {}
    const ra = String(values.ra || '-').toLowerCase()
    const dhcpv6 = String(values.dhcpv6 || '-').toLowerCase()
    const ndp = String(values.ndp || '-').toLowerCase()

    const toMode = (value) => value === 'relay' ? '中继模式' : value === 'server' ? '服务器模式' : '已禁用'
    const toBoolText = (value) => {
      const v = String(value ?? '').trim().toLowerCase()
      return v === '1' || v === 'true' || v === 'yes' || v === 'on' ? '已启用' : '未启用'
    }

    const toList = (value) => {
      if (Array.isArray(value)) {
        return value.map((item) => String(item || '').trim()).filter(Boolean)
      }
      const text = String(value || '').trim()
      return text ? text.split(/[\s,]+/).filter(Boolean) : []
    }

    return {
      designatedMaster: toBoolText(values.master),
      raServiceMode: toMode(ra),
      dhcpv6ServiceMode: toMode(dhcpv6),
      ndpProxyMode: toMode(ndp),
      dhcpv6Mode: toList(values.ra_flags).length ? toList(values.ra_flags).join(' + ') : '-',
      alwaysAdvertiseDefaultRoute: toBoolText(values.ra_default),
      advertisedDnsServers: toList(values.dns),
      advertisedDnsDomains: toList(values.domain),
      sampledAt: Date.now()
    }
  } catch (error) {
    if (!isAccessDeniedError(error)) {
      throw error
    }

    logUbusFallback('fetchDhcpLanIpv6Config', 'uci.get dhcp.lan access denied, fallback to network/dhcp HTML')
    const payload = await fetchMaybeJson(resolveLuciPath(NETWORK_DHCP_PATH))
    const parsed = parseDhcpLanIpv6MetaFromHtml(payload)

    return {
      ...parsed,
      sampledAt: Date.now()
    }
  }
}

/**
 * Data source: UBUS preferred (`uci get AdGuardHome.AdGuardHome`), fallback HTML AdGuardHome
 */
export async function fetchAdGuardHomeConfig() {
  try {
    const payload = await callUbus('uci', 'get', {
      config: 'AdGuardHome',
      section: 'AdGuardHome'
    })
    const parsed = parseAdGuardHomeConfigFromUci(payload)

    return {
      ...parsed,
      sampledAt: Date.now()
    }
  } catch (error) {
    if (!isAccessDeniedError(error)) {
      throw error
    }

    logUbusFallback('fetchAdGuardHomeConfig', 'uci.get AdGuardHome access denied, fallback to AdGuardHome HTML')
    const payload = await fetchMaybeJson(resolveLuciPath(ADGUARD_HOME_PATH))
    const parsed = parseAdGuardHomeMetaFromHtml(payload)

    return {
      ...parsed,
      sampledAt: Date.now()
    }
  }
}

/**
 * Data source: LuCI JSON (`/admin/services/AdGuardHome/status`)
 */
export async function fetchAdGuardHomeStatus() {
  const payload = await fetchMaybeJson(resolveLuciPath(ADGUARD_HOME_STATUS_PATH))

  if (!payload || typeof payload !== 'object') {
    throw new Error('AdGuardHome 状态返回格式无效')
  }

  return {
    running: Boolean(payload.running),
    redirected: Boolean(payload.redirect),
    sampledAt: Date.now()
  }
}

/**
 * Data source: UBUS preferred (`uci get ddns-go.<section>`), fallback HTML ddns-go
 */
export async function fetchDdnsGoConfig() {
  try {
    const all = await callUbus('uci', 'get', {
      config: 'ddns-go'
    })

    const valuesRoot = all?.values && typeof all.values === 'object' ? all.values : {}
    const sectionName = Object.keys(valuesRoot).find((key) => {
      const section = valuesRoot[key]
      return section && typeof section === 'object' && section['.type'] === 'ddns-go'
    }) || Object.keys(valuesRoot)[0] || null

    const sectionPayload = sectionName
      ? await callUbus('uci', 'get', {
        config: 'ddns-go',
        section: sectionName
      })
      : { values: {} }

    const parsed = parseDdnsGoConfigFromUci(sectionPayload)

    return {
      section: sectionName || '',
      ...parsed,
      sampledAt: Date.now()
    }
  } catch (error) {
    if (!isAccessDeniedError(error)) {
      throw error
    }

    logUbusFallback('fetchDdnsGoConfig', 'uci.get ddns-go access denied, fallback to ddns-go HTML')
    const payload = await fetchMaybeJson(resolveLuciPath(DDNS_GO_PATH))
    const parsed = parseDdnsGoMetaFromHtml(payload)

    return {
      ...parsed,
      sampledAt: Date.now()
    }
  }
}

/**
 * Data source: LuCI JSON (`/admin/services/ddnsgo_status`)
 */
export async function fetchDdnsGoStatus() {
  const payload = await fetchMaybeJson(resolveLuciPath(DDNS_GO_STATUS_PATH))

  if (!payload || typeof payload !== 'object') {
    throw new Error('DDNS-GO 状态返回格式无效')
  }

  return {
    running: Boolean(payload.running),
    sampledAt: Date.now()
  }
}

/**
 * Data source: UBUS preferred (`appfilter.*`), fallback LuCI appfilter RPC endpoints
 */
export async function fetchAppFilterStatus() {
  try {
    const [runPayload, basePayload] = await Promise.all([
      callUbus('appfilter', 'get_oaf_status').catch(() => null),
      callUbus('appfilter', 'get_app_filter_base').catch(() => null)
    ])

    const runData = runPayload && typeof runPayload === 'object' ? runPayload.data || runPayload : {}
    const baseData = basePayload && typeof basePayload === 'object' ? basePayload.data || basePayload : {}

    const engineStatus = Number(runData.engine_status)
    const configEnable = Number(runData.config_enable)
    const runtimeEnable = Number(runData.enable)
    const workModeRaw = Number(baseData.work_mode)

    return {
      runningStatus: engineStatus === 1 ? (configEnable === 0 ? '未配置' : runtimeEnable === 1 ? '运行中' : '未运行') : '未运行',
      workMode: workModeRaw === 1 ? '旁路模式' : workModeRaw === 0 ? '网关模式' : '-',
      recordEnabled: Number(baseData.record_enable) === 1 ? '已启用' : Number(baseData.record_enable) === 0 ? '未启用' : '-',
      sampledAt: Date.now()
    }
  } catch (error) {
    if (!isAccessDeniedError(error)) {
      throw error
    }

    logUbusFallback('fetchAppFilterStatus', 'appfilter ubus access denied, fallback to LuCI appfilter endpoints')
    const [runPayload, basePayload] = await Promise.all([
      fetchMaybeJson(resolveLuciPath(APPFILTER_OAF_STATUS_PATH)).catch(() => null),
      fetchMaybeJson(resolveLuciPath(APPFILTER_BASE_PATH)).catch(() => null)
    ])

    const runData = runPayload && typeof runPayload === 'object' ? runPayload.data || {} : {}
    const baseData = basePayload && typeof basePayload === 'object' ? basePayload.data || {} : {}

    const engineStatus = Number(runData.engine_status)
    const configEnable = Number(runData.config_enable)
    const runtimeEnable = Number(runData.enable)
    const workModeRaw = Number(baseData.work_mode)

    return {
      runningStatus: engineStatus === 1 ? (configEnable === 0 ? '未配置' : runtimeEnable === 1 ? '运行中' : '未运行') : '未运行',
      workMode: workModeRaw === 1 ? '旁路模式' : workModeRaw === 0 ? '网关模式' : '-',
      recordEnabled: Number(baseData.record_enable) === 1 ? '已启用' : Number(baseData.record_enable) === 0 ? '未启用' : '-',
      sampledAt: Date.now()
    }
  }
}

/**
 * Data source: UBUS preferred (`uci get network.wan`), fallback HTML network/wan
 */
export async function fetchNetworkWanConfig() {
  try {
    const payload = await callUbus('uci', 'get', {
      config: 'network',
      section: 'wan'
    })

    const values = payload?.values && typeof payload.values === 'object' ? payload.values : {}

    return {
      protocol: String(values.proto || '-'),
      ipv4: String(values.ipaddr || '-'),
      netmask: String(values.netmask || '-'),
      gateway: String(values.gateway || '-'),
      dns: Array.isArray(values.dns)
        ? values.dns.map((item) => String(item || '').trim()).filter(Boolean)
        : typeof values.dns === 'string' && values.dns.trim()
          ? values.dns.split(/[\s,]+/).filter(Boolean)
          : [],
      ipv6assign: String(values.ip6assign || '-'),
      pppoeUsername: String(values.username || '-'),
      pppoePasswordMasked: values.password ? '******' : '-',
      mtu: String(values.mtu || '-'),
      sampledAt: Date.now()
    }
  } catch (error) {
    if (!isAccessDeniedError(error)) {
      throw error
    }

    logUbusFallback('fetchNetworkWanConfig', 'uci.get network.wan access denied, fallback to network/wan HTML')
    const payload = await fetchMaybeJson(resolveLuciPath(NETWORK_WAN_PATH))
    const parsed = parseNetworkInterfaceMetaFromHtml(payload, 'wan')

    return {
      ...parsed,
      sampledAt: Date.now()
    }
  }
}
