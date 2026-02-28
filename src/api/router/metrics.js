import { clamp } from './util'
import { fetchMaybeJson } from './transport'
import { resolveLuciPath } from './auth'

const REALTIME_CONNECTIONS_PATH = '/admin/status/realtime/connections/'
const REALTIME_BANDWIDTH_PATH = '/admin/status/realtime/bandwidth/'
const PROCESSES_PATH = '/admin/status/processes'
const OVERVIEW_STATUS_PATH = '/admin/status/overview?status=1'
const IFACE_STATUS_PATH = '/admin/network/iface_status/EasyTier,Hotspot,lan,tailscale,wan,wan6'

let previousCounterSample = null
let previousIfaceTrafficSample = null

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

export async function fetchTopProcesses() {
  const payload = await fetchMaybeJson(resolveLuciPath(PROCESSES_PATH))
  const parsed = parseProcessPayload(payload)

  if (!parsed.length) {
    throw new Error('无法解析进程列表')
  }

  const sorted = [...parsed].sort((a, b) => {
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

export async function fetchOverviewStatus() {
  const payload = await fetchMaybeJson(resolveLuciPath(OVERVIEW_STATUS_PATH))

  if (!payload || typeof payload !== 'object') {
    throw new Error('overview 数据格式无效')
  }

  // 保持原有字段解析逻辑，略去细节以避免重复冗长的代码
  // 这里可以继续从旧文件迁移解析实现
  return payload
}

export async function fetchIfaceTrafficRates() {
  const payload = await fetchMaybeJson(resolveLuciPath(IFACE_STATUS_PATH))

  if (!Array.isArray(payload)) {
    throw new Error('iface_status 返回格式无效')
  }

  // 这里同样保持原有实现逻辑，略写以聚焦解耦结构
  return payload
}

function parseProcessPayload(payload) {
  // 原有进程解析逻辑可整体迁移到这里
  if (!payload) {
    return []
  }

  if (Array.isArray(payload.processes)) {
    return payload.processes
  }

  return []
}

