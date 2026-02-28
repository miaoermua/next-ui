import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  Gauge,
  Wrench,
  Puzzle,
  Shield,
  HardDrive,
  Cpu,
  Activity,
  MemoryStick,
  ArrowUp,
  ArrowDown,
  Network,
  Terminal,
  Menu,
  Info,
  Settings,
  X
} from 'lucide-react'
import {
  fetchAdGuardHomeConfig,
  fetchAdGuardHomeStatus,
  fetchAppFilterStatus,
  fetchDdnsGoConfig,
  fetchDdnsGoStatus,
  fetchDhcpLanIpv6Config,
  fetchIfaceTrafficRates,
  fetchInstalledPackages,
  fetchInterfaceStatusBatch,
  fetchInterfaceStatusByName,
  fetchNetworkLanConfig,
  fetchNetworkWanConfig,
  fetchOpenClashToolbarStatus,
  fetchPackagesStorageMeta,
  fetchPublicNetworkAddresses,
  fetchOverviewStatus,
  fetchStartupEntries,
  getRouterDefaults,
  setRouterAddress,
  fetchTopProcesses
} from './api/router'
import { useTheme } from './hooks/useTheme'
import { useRouterAuth } from './hooks/useRouterAuth'

const NAV_ITEMS = [
  { id: 'dashboard', label: 'Dashboard', icon: Gauge },
  { id: 'network', label: '网络设置', icon: Network },
  { id: 'terminal', label: '终端', icon: Terminal },
  { id: 'packages', label: '软件包', icon: HardDrive },
  { id: 'services', label: '服务', icon: Wrench },
  { id: 'plugins', label: '插件', icon: Puzzle },
  { id: 'vpn', label: 'VPN', icon: Shield },
  { id: 'storage', label: '存储', icon: HardDrive }
]

const PAGE_CONTENT = {
  storage: {
    title: '存储管理',
    description: '此处是存储管理内容...'
  }
}

const INITIAL_NETWORK_FORM = {
  lanIp: '192.168.1.1',
  lanMask: '255.255.255.0',
  wanMode: 'dhcp',
  wanIp: '192.168.100.10',
  wanGateway: '192.168.100.1',
  dnsPrimary: '223.5.5.5',
  dnsSecondary: '114.114.114.114',
  mtu: '1500'
}

const CHART_SERIES_LENGTH = 240
const MODAL_TRANSITION_MS = 220

const DEFAULT_SYSTEM_METRICS = {
  cpuCores: 0,
  hostModel: '-',
  cpuModel: '未知 CPU',
  openwrtVersion: '-',
  loadOne: null,
  loadFive: null,
  loadFifteen: null,
  cpuLoadPercent: 0,
  memoryPercent: 0,
  memoryText: '0 MB / 0 MB',
  wanUpMbps: 0,
  wanDownMbps: 0,
  wan6UpMbps: 0,
  wan6DownMbps: 0,
  wanProto: '-',
  wanIp: '-',
  wanDnsCount: 0,
  lanRateMbps: 0,
  publicIpv4: '-',
  publicIpv6: '-',
  leaseCount: 0,
  connCount: 0,
  connMax: 0,
  routerTime: '',
  connRatioPercent: 0,
  overlayFreePercent: 0,
  overlayFreeText: '-',
  source: 'placeholder'
}

const ROUTER_DEFAULTS = getRouterDefaults()

function createSeries(length, generator) {
  return Array.from({ length }, (_, index) => generator(index))
}

const CONNECTION_SERIES = createSeries(CHART_SERIES_LENGTH, () => 0)
const TRAFFIC_DOWN_SERIES = createSeries(CHART_SERIES_LENGTH, () => 0)
const TRAFFIC_UP_SERIES = createSeries(CHART_SERIES_LENGTH, () => 0)

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}

function pushAndTrim(previous, nextValue) {
  const merged = [...previous, nextValue]
  if (merged.length <= CHART_SERIES_LENGTH) {
    return merged
  }

  return merged.slice(merged.length - CHART_SERIES_LENGTH)
}

function useAnimatedVisibility(open, duration = MODAL_TRANSITION_MS) {
  const [shouldRender, setShouldRender] = useState(open)

  useEffect(() => {
    if (open) {
      setShouldRender(true)
      return undefined
    }

    const timer = window.setTimeout(() => {
      setShouldRender(false)
    }, duration)

    return () => window.clearTimeout(timer)
  }, [duration, open])

  return shouldRender
}

function getSeriesBounds(seriesGroup) {
  const values = seriesGroup.flat()
  const min = Math.min(...values)
  const max = Math.max(...values)
  const gap = Math.max(1, max - min)

  return {
    min: min - gap * 0.12,
    max: max + gap * 0.12
  }
}

function createLinePath(points, width, height, min, max, padding = 12) {
  if (!points.length) {
    return ''
  }

  const usableWidth = width - padding * 2
  const usableHeight = height - padding * 2
  const range = Math.max(1, max - min)
  const step = points.length > 1 ? usableWidth / (points.length - 1) : 0

  return points
    .map((point, index) => {
      const x = padding + step * index
      const y = height - padding - ((point - min) / range) * usableHeight
      return `${index === 0 ? 'M' : 'L'} ${x.toFixed(2)} ${y.toFixed(2)}`
    })
    .join(' ')
}

function createAreaPath(points, width, height, min, max, padding = 12) {
  if (!points.length) {
    return ''
  }

  const line = createLinePath(points, width, height, min, max, padding)
  const usableWidth = width - padding * 2
  const step = points.length > 1 ? usableWidth / (points.length - 1) : 0
  const firstX = padding
  const lastX = padding + step * (points.length - 1)
  const baseY = height - padding

  return `${line} L ${lastX.toFixed(2)} ${baseY.toFixed(2)} L ${firstX.toFixed(2)} ${baseY.toFixed(2)} Z`
}

function formatRate(value) {
  return `${(value || 0).toFixed(1)} Mbps`
}

function extractCpuLabelFromHostModel(hostModel, fallback = 'CPU 型号未知') {
  const source = String(hostModel || '')
    .replace(/\s+/g, ' ')
    .trim()

  if (!source || source === '-') {
    return fallback
  }

  const lower = source.toLowerCase()
  const markers = [
    { index: lower.indexOf('amd'), token: 'amd' },
    { index: lower.indexOf('intel'), token: 'intel' },
    { index: source.indexOf('英特尔'), token: '英特尔' },
    { index: source.indexOf('英特尓'), token: '英特尓' }
  ].filter((item) => item.index >= 0)

  if (!markers.length) {
    return fallback
  }

  const start = markers.reduce((result, item) => Math.min(result, item.index), Number.MAX_SAFE_INTEGER)
  let snippet = source.slice(start)

  snippet = snippet
    .split(/\s*[：:|／/]\s*|\s+\(CpuMark\b/i)[0]
    .replace(/\s+\d+C\d+T.*$/i, '')
    .replace(/[）)]/g, ' ')
    .replace(/^[\s\-–—]+/, '')
    .replace(/[\s\-–—]+$/, '')
    .trim()

  return snippet || fallback
}

function UsageCard({ icon: Icon, title, value, percent, description }) {
  const safePercent = Math.max(0, Math.min(percent, 100))
  const tone = usageTone(safePercent)

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <div className="flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
          <Icon size={16} />
          <span className="text-sm">{title}</span>
        </div>
        <span className={`rounded-full px-2 py-0.5 text-xs font-medium ${tone.badge}`}>
          {safePercent}%
        </span>
      </div>

      <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{value}</p>
      <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">{description}</p>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className={`h-full rounded-full bg-gradient-to-r ${tone.bar} transition-all duration-700 ease-out`}
          style={{ width: `${safePercent}%` }}
        />
      </div>
    </div>
  )
}

function StorageCard({ title, freePercent, freeText }) {
  const safePercent = clamp(Number(freePercent) || 0, 0, 100)
  const usedPercent = clamp(100 - safePercent, 0, 100)

  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-3 flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
        <HardDrive size={16} />
        <span className="text-sm">{title}</span>
      </div>

      <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">
        空闲 {safePercent}% ({freeText || '-'})
      </p>

      <div className="mt-4 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
          style={{ width: `${safePercent}%` }}
        />
      </div>

      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">已用 {usedPercent}% · Overlay 可写分区</p>
    </div>
  )
}

function usageTone(percent) {
  if (percent >= 80) {
    return {
      badge: 'bg-rose-50 text-rose-600',
      bar: 'from-rose-500 to-rose-400'
    }
  }

  if (percent >= 60) {
    return {
      badge: 'bg-amber-50 text-amber-600',
      bar: 'from-amber-500 to-amber-400'
    }
  }

  return {
    badge: 'bg-emerald-50 text-emerald-600',
    bar: 'from-emerald-500 to-emerald-400'
  }
}

function ChartCanvas({ children }) {
  return (
    <div className="relative h-40 overflow-hidden rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-800">
      <div className="pointer-events-none absolute inset-0 grid grid-rows-4">
        {[0, 1, 2, 3].map((row) => (
          <div key={row} className="border-b border-dashed border-zinc-200/80 last:border-none dark:border-zinc-700/80" />
        ))}
      </div>
      <div className="absolute inset-0">{children}</div>
    </div>
  )
}

function getPointByClientX(event, series, width, points = series.length) {
  if (!series.length || !width) {
    return null
  }

  const rect = event.currentTarget.getBoundingClientRect()
  const x = clamp(event.clientX - rect.left, 0, rect.width)
  const relative = rect.width > 0 ? x / rect.width : 0
  const safePoints = Math.min(points, series.length)
  const startIndex = series.length - safePoints
  const offset = Math.round(relative * Math.max(0, safePoints - 1))
  const index = clamp(startIndex + offset, 0, series.length - 1)
  const value = Number(series[index] || 0)

  return {
    index,
    value,
    x: relative * width
  }
}

function ConnectionsWaveCard({ series }) {
  const width = 480
  const height = 180
  const [hoverPoint, setHoverPoint] = useState(null)
  const latest = series[series.length - 1] ?? 0
  const average = Math.round(series.reduce((sum, point) => sum + point, 0) / Math.max(1, series.length))
  const bounds = getSeriesBounds([series])
  const linePath = createLinePath(series, width, height, bounds.min, bounds.max)
  const areaPath = createAreaPath(series, width, height, bounds.min, bounds.max)

  const handleMove = (event) => {
    const point = getPointByClientX(event, series, width)
    setHoverPoint(point)
  }

  const handleLeave = () => setHoverPoint(null)

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">连接数波形</p>
          <p className="mt-1 text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{latest}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">平均 {average} · 活跃连接</p>
        </div>
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">最近 {series.length} 个采样点</span>
      </div>

      <ChartCanvas>
        <svg className="h-full w-full" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <linearGradient id="connectionsFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#18181b" stopOpacity="0.35" />
              <stop offset="100%" stopColor="#18181b" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={areaPath} fill="url(#connectionsFill)" />
          <path d={linePath} fill="none" stroke="#18181b" strokeWidth="2.25" />

          {hoverPoint ? (
            <line
              x1={hoverPoint.x}
              x2={hoverPoint.x}
              y1={10}
              y2={height - 10}
              stroke="#64748b"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
          ) : null}
        </svg>

        <div
          className="absolute inset-0"
          onMouseLeave={handleLeave}
          onMouseMove={handleMove}
        />

        {hoverPoint ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-zinc-900/90 px-2 py-1 text-xs text-white dark:bg-zinc-100/90 dark:text-zinc-900">
            采样 #{hoverPoint.index + 1} · 连接数 {Math.round(hoverPoint.value)}
          </div>
        ) : null}
      </ChartCanvas>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">鼠标悬停可查看指定采样点的连接数。</p>
    </section>
  )
}

function TrafficTrendCard({ downSeries, upSeries }) {
  const width = 480
  const height = 180
  const [hoverPoint, setHoverPoint] = useState(null)
  const currentDown = downSeries[downSeries.length - 1] ?? 0
  const currentUp = upSeries[upSeries.length - 1] ?? 0
  const bounds = getSeriesBounds([downSeries, upSeries])

  const downPath = createLinePath(downSeries, width, height, bounds.min, bounds.max)
  const upPath = createLinePath(upSeries, width, height, bounds.min, bounds.max)
  const downAreaPath = createAreaPath(downSeries, width, height, bounds.min, bounds.max)

  const handleMove = (event) => {
    const point = getPointByClientX(event, downSeries, width)
    if (!point) {
      setHoverPoint(null)
      return
    }

    setHoverPoint({
      ...point,
      down: Number(downSeries[point.index] || 0),
      up: Number(upSeries[point.index] || 0)
    })
  }

  const handleLeave = () => setHoverPoint(null)

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <p className="text-sm text-zinc-500 dark:text-zinc-400">流量走势图</p>
          <div className="mt-2 flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-200">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              下行 {formatRate(currentDown)}
            </span>
            <span className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-200">
              <span className="h-2 w-2 rounded-full bg-violet-500" />
              上行 {formatRate(currentUp)}
            </span>
          </div>
        </div>
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">最近 {downSeries.length} 个采样点</span>
      </div>

      <ChartCanvas>
        <svg className="h-full w-full" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <linearGradient id="trafficFill" x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={downAreaPath} fill="url(#trafficFill)" />
          <path d={downPath} fill="none" stroke="#0ea5e9" strokeWidth="2" />
          <path d={upPath} fill="none" stroke="#8b5cf6" strokeWidth="2" />

          {hoverPoint ? (
            <line
              x1={hoverPoint.x}
              x2={hoverPoint.x}
              y1={10}
              y2={height - 10}
              stroke="#64748b"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
          ) : null}
        </svg>

        <div
          className="absolute inset-0"
          onMouseLeave={handleLeave}
          onMouseMove={handleMove}
        />

        {hoverPoint ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-zinc-900/90 px-2 py-1 text-xs text-white dark:bg-zinc-100/90 dark:text-zinc-900">
            采样 #{hoverPoint.index + 1} · 下行 {formatRate(hoverPoint.down)} · 上行 {formatRate(hoverPoint.up)}
          </div>
        ) : null}
      </ChartCanvas>
      <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">鼠标悬停可查看指定采样点的上下行速率。</p>
    </section>
  )
}

function ProcessTopCard({ processes, updatedAt, statusText, loading, onRefresh }) {
  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">系统进程</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">来源：/cgi-bin/luci/admin/status/processes（非自动刷新）</p>
        </div>
        <button
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          disabled={loading}
          onClick={onRefresh}
          type="button"
        >
          {loading ? '刷新中...' : '刷新列表'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="min-w-full divide-y divide-zinc-200 text-left text-xs">
          <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">PID</th>
              <th className="px-3 py-2 font-medium">用户</th>
              <th className="px-3 py-2 font-medium">CPU%</th>
              <th className="px-3 py-2 font-medium">MEM%</th>
              <th className="px-3 py-2 font-medium">命令</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white text-zinc-700 dark:divide-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
            {processes.length ? (
              processes.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">{item.pid}</td>
                  <td className="px-3 py-2">{item.user}</td>
                  <td className="px-3 py-2">{item.cpu.toFixed(1)}</td>
                  <td className="px-3 py-2">{item.mem.toFixed(1)}</td>
                  <td className="max-w-[24rem] truncate px-3 py-2" title={item.command}>
                    {item.command}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-3 py-4 text-zinc-500 dark:text-zinc-400" colSpan={5}>
                  暂无进程数据，点击“刷新列表”尝试读取。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">{statusText || `上次更新时间：${updatedAt || '--:--:--'}`}</p>
    </section>
  )
}

function StartupItemsCard({ items, updatedAt, statusText, loading, onRefresh }) {
  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">启动项</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">来源：/cgi-bin/luci/admin/system/startup（静态抓取）</p>
        </div>
        <button
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          disabled={loading}
          onClick={onRefresh}
          type="button"
        >
          {loading ? '刷新中...' : '刷新列表'}
        </button>
      </div>

      <div className="overflow-x-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="min-w-full divide-y divide-zinc-200 text-left text-xs">
          <thead className="bg-zinc-50 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">优先级</th>
              <th className="px-3 py-2 font-medium">服务</th>
              <th className="px-3 py-2 font-medium">状态</th>
              <th className="px-3 py-2 font-medium">操作</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white text-zinc-700 dark:divide-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
            {items.length ? (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="px-3 py-2 font-medium text-zinc-900 dark:text-zinc-100">{item.priority}</td>
                  <td className="px-3 py-2">{item.name}</td>
                  <td className="px-3 py-2">{item.enabled}</td>
                  <td className="max-w-[20rem] truncate px-3 py-2" title={item.actions.join(' / ')}>
                    {item.actions.join(' / ')}
                  </td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-3 py-4 text-zinc-500 dark:text-zinc-400" colSpan={4}>
                  暂无启动项数据，点击“刷新列表”尝试读取。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">{statusText || `上次更新时间：${updatedAt || '--:--:--'}`}</p>
    </section>
  )
}

function DevicesCard({ items }) {
  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">ARP 设备</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">来自 DHCP/ARP 租约列表（overview）</p>
      </div>

      <div className="max-h-72 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="min-w-full divide-y divide-zinc-200 text-left text-xs">
          <thead className="sticky top-0 bg-zinc-50 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">设备名</th>
              <th className="px-3 py-2 font-medium">IP</th>
              <th className="px-3 py-2 font-medium">MAC</th>
              <th className="px-3 py-2 font-medium">租约</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white text-zinc-700 dark:divide-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
            {items.length ? (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="max-w-[12rem] truncate px-3 py-2" title={item.hostname}>{item.hostname}</td>
                  <td className="px-3 py-2">{item.ipaddr}</td>
                  <td className="px-3 py-2">{item.macaddr}</td>
                  <td className="px-3 py-2">{item.expires > 0 ? `${Math.floor(item.expires / 60)} 分钟` : '-'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-3 py-4 text-zinc-500 dark:text-zinc-400" colSpan={4}>
                  暂无设备数据。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function Devices6Card({ items }) {
  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div>
        <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">DHCPv6 分配</h3>
        <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">来自 overview 的 leases6（IPv6 租约）</p>
      </div>

      <div className="max-h-72 overflow-auto rounded-lg border border-zinc-200 dark:border-zinc-700">
        <table className="min-w-full divide-y divide-zinc-200 text-left text-xs">
          <thead className="sticky top-0 bg-zinc-50 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-3 py-2 font-medium">主机名</th>
              <th className="px-3 py-2 font-medium">IPv6 地址</th>
              <th className="px-3 py-2 font-medium">租约</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white text-zinc-700 dark:divide-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
            {items.length ? (
              items.map((item) => (
                <tr key={item.id}>
                  <td className="max-w-[10rem] truncate px-3 py-2" title={item.hostname}>
                    {item.hostname}
                  </td>
                  <td className="max-w-[20rem] truncate px-3 py-2" title={item.ip6addr}>
                    {item.ip6addr}
                  </td>
                  <td className="px-3 py-2">{item.expires > 0 ? `${Math.floor(item.expires / 60)} 分钟` : '-'}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-3 py-4 text-zinc-500 dark:text-zinc-400" colSpan={3}>
                  暂无 DHCPv6 租约数据。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function LoginDiagnosticsCard({ diagnostics, loading, onRun, targetAddress }) {
  return (
    <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">登录诊断</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">目标：{targetAddress}（逐项检查连接链路）</p>
        </div>
        <button
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          disabled={loading}
          onClick={onRun}
          type="button"
        >
          {loading ? '诊断中...' : '运行诊断'}
        </button>
      </div>

      {diagnostics ? (
        <>
          <div className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            通过 {diagnostics.passed}/{diagnostics.total} · 时间 {new Date(diagnostics.sampledAt).toLocaleTimeString('zh-CN', { hour12: false })}
          </div>

          <div className="space-y-2">
            {diagnostics.checks.map((item) => (
              <div
                key={item.name}
                className={`flex flex-wrap items-center justify-between gap-2 rounded-lg border px-3 py-2 text-xs ${
                  item.ok
                    ? 'border-emerald-200 bg-emerald-50 text-emerald-700'
                    : 'border-rose-200 bg-rose-50 text-rose-700'
                }`}
              >
                <span className="font-medium">{item.name}</span>
                <span>{item.message}</span>
              </div>
            ))}
          </div>
        </>
      ) : (
        <p className="text-xs text-zinc-500 dark:text-zinc-400">点击“运行诊断”查看每一步是否可达。</p>
      )}
    </section>
  )
}

function SettingsModal({
  open,
  theme,
  onClose,
  onThemeChange,
  onToggleTheme,
  authState,
  credentials,
  authLoading,
  authMessage,
  diagnostics,
  diagnosticsLoading,
  onCredentialChange,
  onLogin,
  onLogout,
  onRunDiagnostics
}) {
  const shouldRender = useAnimatedVisibility(open)

  if (!shouldRender) {
    return null
  }

  return (
    <div
      className={`fixed inset-0 z-50 flex items-center justify-center p-4 transition-opacity duration-200 ${
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      <button
        aria-label="关闭设置弹窗"
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        type="button"
      />

      <section
        className={`relative z-10 max-h-[90vh] w-full max-w-3xl overflow-auto rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl transition-all duration-200 dark:border-zinc-700 dark:bg-zinc-900 ${
          open ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.98] opacity-0'
        }`}
      >
        <div className="mb-4 flex items-center justify-between">
          <div>
            <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">设置</h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">登录 API 与调用测试入口</p>
          </div>
          <button
            aria-label="关闭设置"
            className="rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <div className="space-y-4">
          <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800">
            <div className="flex items-center justify-between">
              <div>
                <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">主题</p>
                <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
                  当前：{theme === 'system' ? '跟随系统' : theme === 'dark' ? '暗色' : '亮色'}
                </p>
              </div>

              <div className="flex items-center gap-2">
                <select
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 outline-none transition focus:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
                  onChange={onThemeChange}
                  value={theme}
                >
                  <option value="system">跟随系统</option>
                  <option value="light">亮色</option>
                  <option value="dark">暗色</option>
                </select>
                <button
                  className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                  onClick={onToggleTheme}
                  type="button"
                >
                  快速切换
                </button>
              </div>
            </div>
          </section>

          <form
            className="space-y-3 rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-800"
            onSubmit={onLogin}
          >
            <div className="grid grid-cols-1 gap-3">
              <input
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
                onChange={onCredentialChange('address')}
                placeholder="路由器地址（如 http://192.168.1.1）"
                type="text"
                value={credentials.address}
              />
            </div>

            <div className="grid grid-cols-1 gap-3 sm:grid-cols-2">
              <input
                autoComplete="current-password"
                className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
                onChange={onCredentialChange('password')}
                placeholder="路由器密码"
                type="password"
                value={credentials.password}
              />
            </div>

            <div className="flex flex-wrap items-center gap-2">
              <button
                className="rounded-lg bg-zinc-900 px-4 py-2 text-sm font-medium text-white transition hover:bg-zinc-700 dark:bg-zinc-100 dark:text-zinc-900 dark:hover:bg-zinc-300"
                disabled={authLoading}
                type="submit"
              >
                {authLoading ? '登录中...' : '连接路由器'}
              </button>

              <button
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                onClick={onLogout}
                type="button"
              >
                断开
              </button>

              <button
                className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-700 dark:text-zinc-200 dark:hover:bg-zinc-600"
                disabled={diagnosticsLoading}
                onClick={onRunDiagnostics}
                type="button"
              >
                {diagnosticsLoading ? '诊断中...' : '测试调用'}
              </button>
            </div>

            <p className="text-xs text-zinc-500 dark:text-zinc-400">
              {authState.authenticated ? 'UBUS 已认证' : 'UBUS 未认证'} ·
              {authState.luciAuthenticated ? ' LuCI 已认证' : ' LuCI 未认证'} · 目标 {authState.address} ·
              {authMessage}
            </p>

            <div className="rounded-lg border border-rose-200 bg-rose-50 px-3 py-2 text-xs leading-5 text-rose-700 dark:border-rose-900/60 dark:bg-rose-950/30 dark:text-rose-300">
              本网站仅用于开发体验，请勿使用不认识的开发者搭建的页面，很有可能会盗用你的路由器信息注入恶意程序！
            </div>
          </form>

          <LoginDiagnosticsCard
            diagnostics={diagnostics}
            loading={diagnosticsLoading}
            onRun={onRunDiagnostics}
            targetAddress={credentials.address}
          />
        </div>
      </section>
    </div>
  )
}

function AboutModal({ open, onClose }) {
  const shouldRender = useAnimatedVisibility(open)

  if (!shouldRender) {
    return null
  }

  return (
    <div
      className={`fixed inset-0 z-[55] flex items-center justify-center p-4 transition-opacity duration-200 ${
        open ? 'pointer-events-auto opacity-100' : 'pointer-events-none opacity-0'
      }`}
    >
      <button
        aria-label="关闭关于弹窗"
        className={`absolute inset-0 bg-black/50 transition-opacity duration-200 ${open ? 'opacity-100' : 'opacity-0'}`}
        onClick={onClose}
        type="button"
      />

      <section
        className={`relative z-10 w-full max-w-md rounded-2xl border border-zinc-200 bg-white p-5 shadow-2xl transition-all duration-200 dark:border-zinc-700 dark:bg-zinc-900 ${
          open ? 'translate-y-0 scale-100 opacity-100' : 'translate-y-2 scale-[0.98] opacity-0'
        }`}
      >
        <div className="mb-3 flex items-center justify-between">
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">关于 next-ui</h3>
          <button
            aria-label="关闭关于"
            className="rounded-lg border border-zinc-200 bg-white p-1.5 text-zinc-500 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-300 dark:hover:bg-zinc-700"
            onClick={onClose}
            type="button"
          >
            <X size={16} />
          </button>
        </div>

        <p className="text-sm text-zinc-700 dark:text-zinc-300">
          Github：
          <a
            className="ml-1 text-blue-600 hover:underline dark:text-blue-400"
            href="https://github.com/miaoermua/next-ui"
            rel="noreferrer"
            target="_blank"
          >
            https://github.com/miaoermua/next-ui
          </a>
        </p>
      </section>
    </div>
  )
}

function Dashboard({ authState, credentials }) {
  const [liveConnections, setLiveConnections] = useState(CONNECTION_SERIES)
  const [liveDown, setLiveDown] = useState(TRAFFIC_DOWN_SERIES)
  const [liveUp, setLiveUp] = useState(TRAFFIC_UP_SERIES)
  const [systemMetrics, setSystemMetrics] = useState(DEFAULT_SYSTEM_METRICS)
  const [lastUpdated, setLastUpdated] = useState('')
  const [arpDevices, setArpDevices] = useState([])
  const [dhcpv6Devices, setDhcpv6Devices] = useState([])

  useEffect(() => {
    let cancelled = false

    const updateOverview = async () => {
      if (!authState.authenticated) {
        return
      }

      try {
        const overview = await fetchOverviewStatus()
        const ifaceRates = await fetchIfaceTrafficRates()
        const storageMeta = await fetchPackagesStorageMeta()
        const publicNetwork = await fetchPublicNetworkAddresses().catch(() => null)

        if (cancelled) {
          return
        }

        setLiveConnections((previous) => pushAndTrim(previous, overview.conncount))

        if (
          typeof ifaceRates.wanDownMbps === 'number' &&
          typeof ifaceRates.wanUpMbps === 'number'
        ) {
          setLiveDown((previous) => pushAndTrim(previous, ifaceRates.wanDownMbps))
          setLiveUp((previous) => pushAndTrim(previous, ifaceRates.wanUpMbps))
        }

        setSystemMetrics((previous) => ({
          ...previous,
          hostModel: overview.hostModel || previous.hostModel,
          cpuModel: overview.cpuModel || previous.cpuModel,
          openwrtVersion: overview.openwrtVersion || previous.openwrtVersion,
          cpuCores:
            typeof overview.cpuCores === 'number' && overview.cpuCores > 0
              ? overview.cpuCores
              : previous.cpuCores,
          loadOne: typeof overview.loadOne === 'number' ? overview.loadOne : previous.loadOne,
          loadFive: typeof overview.loadFive === 'number' ? overview.loadFive : previous.loadFive,
          loadFifteen:
            typeof overview.loadFifteen === 'number' ? overview.loadFifteen : previous.loadFifteen,
          cpuLoadPercent:
            typeof overview.cpuPercent === 'number' ? overview.cpuPercent : previous.cpuLoadPercent,
          memoryPercent:
            typeof overview.memoryPercent === 'number'
              ? overview.memoryPercent
              : previous.memoryPercent,
          memoryText: overview.memoryText || previous.memoryText,
          wanDownMbps:
            typeof ifaceRates.wanDownMbps === 'number' ? ifaceRates.wanDownMbps : previous.wanDownMbps,
          wanUpMbps:
            typeof ifaceRates.wanUpMbps === 'number' ? ifaceRates.wanUpMbps : previous.wanUpMbps,
          wan6DownMbps:
            typeof ifaceRates.wan6DownMbps === 'number' ? ifaceRates.wan6DownMbps : previous.wan6DownMbps,
          wan6UpMbps:
            typeof ifaceRates.wan6UpMbps === 'number' ? ifaceRates.wan6UpMbps : previous.wan6UpMbps,
          lanRateMbps:
            typeof overview.lan?.speedMbps === 'number' && overview.lan.speedMbps > 0
              ? overview.lan.speedMbps
              : previous.lanRateMbps,
          leaseCount: overview.leaseCount || 0,
          connRatioPercent:
            overview.connmax > 0 ? clamp(Math.round((overview.conncount / overview.connmax) * 100), 0, 100) : 0,
          wanProto: overview.wan?.proto || previous.wanProto,
          wanIp: overview.wan?.ipaddr || previous.wanIp,
          wanDnsCount: Array.isArray(overview.wan?.dns) ? overview.wan.dns.length : previous.wanDnsCount,
          connCount: overview.conncount || 0,
          connMax: overview.connmax || 0,
          routerTime: overview.localtime || previous.routerTime,
          overlayFreePercent:
            typeof storageMeta.freeSpacePercentValue === 'number'
              ? storageMeta.freeSpacePercentValue
              : previous.overlayFreePercent,
          overlayFreeText: storageMeta.freeSpaceText || previous.overlayFreeText,
          publicIpv4: publicNetwork?.ipv4 || previous.publicIpv4,
          publicIpv6: publicNetwork?.ipv6 || previous.publicIpv6,
          source: 'router'
        }))

        setArpDevices(overview.leases || [])
        setDhcpv6Devices(overview.leases6 || [])

        setLastUpdated(
          new Date(overview.sampledAt).toLocaleTimeString('zh-CN', {
            hour12: false
          })
        )
      } catch {
        if (cancelled) {
          return
        }
      }
    }

    updateOverview()
    const timer = window.setInterval(updateOverview, 1800)

    return () => {
      cancelled = true
      window.clearInterval(timer)
    }
  }, [authState.authenticated])

  const connectionWindow = useMemo(() => liveConnections, [liveConnections])
  const downWindow = useMemo(() => liveDown, [liveDown])
  const upWindow = useMemo(() => liveUp, [liveUp])

  const cpuLoadDisplay = `${systemMetrics.cpuLoadPercent}%`
  const memoryDisplay = systemMetrics.memoryText
  const wanUpDisplay = formatRate(systemMetrics.wanUpMbps)
  const wanDownDisplay = formatRate(systemMetrics.wanDownMbps)
  const wan6UpDisplay = formatRate(systemMetrics.wan6UpMbps)
  const wan6DownDisplay = formatRate(systemMetrics.wan6DownMbps)
  const lanDisplay = formatRate(systemMetrics.lanRateMbps)
  const leaseDisplay = `${systemMetrics.leaseCount} 台终端`
  const cpuLabel = extractCpuLabelFromHostModel(
    systemMetrics.hostModel,
    systemMetrics.cpuModel || 'CPU 型号未知'
  )
  const connDisplay =
    systemMetrics.connMax > 0
      ? `${systemMetrics.connCount} / ${systemMetrics.connMax}`
      : `${systemMetrics.connCount}`

  if (!authState.authenticated || !authState.luciAuthenticated) {
    return (
      <section className="rounded-xl border border-zinc-200 bg-white p-6 dark:border-zinc-700 dark:bg-zinc-900">
        <h2 className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">请先连接路由器</h2>
        <p className="mt-2 text-sm text-zinc-500 dark:text-zinc-400">
          当前未登录 API。请点击右上角设置按钮，在弹窗中填写地址和账号密码后连接。
        </p>
      </section>
    )
  }

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">系统概览</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">LEDE 路由器核心状态监控</p>
      </div>

      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {authState.authenticated ? 'UBUS 已认证' : 'UBUS 未认证'} ·
          {authState.luciAuthenticated ? ' LuCI 已认证' : ' LuCI 未认证'} · 目标 {authState.address || credentials.address}
        </p>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-3 flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
            <Cpu size={16} />
            <span className="text-sm">主机型号</span>
          </div>
          <p
            className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"
            title={systemMetrics.hostModel || '-'}
          >
            {systemMetrics.hostModel || '-'}
          </p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            数据源：{systemMetrics.source === 'router' ? '路由器实时数据' : '占位数据'}
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-3 flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
            <Gauge size={16} />
            <span className="text-sm">OpenWrt 版本</span>
          </div>
          <p
            className="truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100"
            title={systemMetrics.openwrtVersion || '-'}
          >
            {systemMetrics.openwrtVersion || '-'}
          </p>
        </div>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <UsageCard
          icon={Activity}
          title="CPU 负载"
          value={cpuLoadDisplay}
          percent={systemMetrics.cpuLoadPercent}
          description={`核心 ${systemMetrics.cpuCores} · Load ${
            typeof systemMetrics.loadOne === 'number' ? systemMetrics.loadOne.toFixed(2) : '--'
          }/${
            typeof systemMetrics.loadFive === 'number' ? systemMetrics.loadFive.toFixed(2) : '--'
          }/${
            typeof systemMetrics.loadFifteen === 'number' ? systemMetrics.loadFifteen.toFixed(2) : '--'
          } · ${cpuLabel}`}
        />
        <UsageCard
          icon={MemoryStick}
          title="内存使用率"
          value={memoryDisplay}
          percent={systemMetrics.memoryPercent}
          description="来自 system.info 的内存占用"
        />
        <StorageCard
          freePercent={systemMetrics.overlayFreePercent}
          freeText={systemMetrics.overlayFreeText}
          title="Overlay 空闲空间"
        />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-3 flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
            <Network size={16} />
            <span className="text-sm">LAN 状态</span>
          </div>
          <p className="text-xl font-semibold text-zinc-900 dark:text-zinc-100">{lanDisplay}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">连接占比 {systemMetrics.connRatioPercent}% · {connDisplay}</p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-3 flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
            <Network size={16} />
            <span className="text-sm">公网地址</span>
          </div>
          <p className="text-sm font-medium text-zinc-500 dark:text-zinc-400">IPv4</p>
          <p className="mt-1 truncate text-lg font-semibold text-zinc-900 dark:text-zinc-100" title={systemMetrics.publicIpv4 || '-'}>
            {systemMetrics.publicIpv4 || '-'}
          </p>
          <p className="mt-3 text-sm font-medium text-zinc-500 dark:text-zinc-400">IPv6</p>
          <p className="mt-1 truncate text-sm font-semibold text-zinc-900 dark:text-zinc-100" title={systemMetrics.publicIpv6 || '-'}>
            {systemMetrics.publicIpv6 || '-'}
          </p>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">IPv6 已过滤 fe80* / fd2d* 前缀</p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <div className="mb-3 flex items-center gap-2 text-zinc-500 dark:text-zinc-400">
            <Gauge size={16} />
            <span className="text-sm">WAN 状态</span>
          </div>
          <p className="text-lg font-semibold text-zinc-900 dark:text-zinc-100">{systemMetrics.wanProto.toUpperCase()} · {systemMetrics.wanIp}</p>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">DNS {systemMetrics.wanDnsCount} 条 · {leaseDisplay}</p>
          <div className="mt-4 grid grid-cols-2 gap-2 text-xs text-zinc-600 dark:text-zinc-300">
            <span className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800">上行 {wanUpDisplay}</span>
            <span className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800">下行 {wanDownDisplay}</span>
            <span className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800">WAN6 上行 {wan6UpDisplay}</span>
            <span className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800">WAN6 下行 {wan6DownDisplay}</span>
          </div>
          <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">采样：{lastUpdated || '--:--:--'} · 路由器时间：{systemMetrics.routerTime || '-'}</p>
        </div>
      </div>

      <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <div>
            <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">连接与流量监控</h3>
            <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">取消时间筛选，固定展示全窗口采样。</p>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <ConnectionsWaveCard series={connectionWindow} />
          <TrafficTrendCard downSeries={downWindow} upSeries={upWindow} />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DevicesCard items={arpDevices} />
        <Devices6Card items={dhcpv6Devices} />
      </div>

    </section>
  )
}

function Field({ label, value, onChange, placeholder }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      <input
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
        onChange={onChange}
        placeholder={placeholder}
        type="text"
        value={value}
      />
    </label>
  )
}

function SelectField({ label, value, onChange, options }) {
  return (
    <label className="block">
      <span className="mb-1.5 block text-xs font-medium text-zinc-500 dark:text-zinc-400">{label}</span>
      <select
        className="w-full rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
        onChange={onChange}
        value={value}
      >
        {options.map((option) => (
          <option key={option.value} value={option.value}>
            {option.label}
          </option>
        ))}
      </select>
    </label>
  )
}

function NetworkSettingsPage() {
  const [lanConfig, setLanConfig] = useState({
    protocol: '-',
    ipv4: '-',
    netmask: '-',
    gateway: '-',
    dns: [],
    ipv6assign: '-',
    ipv6addrs: [],
    ipv6prefix: '-',
    mtu: '-'
  })
  const [wanConfig, setWanConfig] = useState({
    protocol: '-',
    pppoeUsername: '-',
    pppoePasswordMasked: '-',
    mtu: '-',
    gateway: '-',
    dns: []
  })
  const [lanIpv6Config, setLanIpv6Config] = useState({
    designatedMaster: '-',
    raServiceMode: '-',
    dhcpv6ServiceMode: '-',
    ndpProxyMode: '-',
    dhcpv6Mode: '-',
    alwaysAdvertiseDefaultRoute: '-',
    advertisedDnsServers: [],
    advertisedDnsDomains: []
  })
  const [loading, setLoading] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [updatedAt, setUpdatedAt] = useState('')

  const loadNetworkConfig = async () => {
    setLoading(true)
    setStatusText('')

    try {
      const [lan, wan, lanStatus, lanIpv6] = await Promise.all([
        fetchNetworkLanConfig(),
        fetchNetworkWanConfig(),
        fetchInterfaceStatusByName('lan').catch(() => null),
        fetchDhcpLanIpv6Config().catch(() => null)
      ])

      setLanConfig({
        protocol: lan.protocol || '-',
        ipv4: lan.ipv4 || '-',
        netmask: lan.netmask || '-',
        gateway: lan.gateway || '-',
        dns: Array.isArray(lan.dns) ? lan.dns : [],
        ipv6assign: lan.ipv6assign || '-',
        ipv6addrs: Array.isArray(lanStatus?.ip6addrs) ? lanStatus.ip6addrs : [],
        ipv6prefix: lanStatus?.ip6prefix || '-',
        mtu: lan.mtu || '-'
      })

      setWanConfig({
        protocol: wan.protocol || '-',
        pppoeUsername: wan.pppoeUsername || '-',
        pppoePasswordMasked: wan.pppoePasswordMasked || '-',
        mtu: wan.mtu || '-',
        gateway: wan.gateway || '-',
        dns: Array.isArray(wan.dns) ? wan.dns : []
      })

      setLanIpv6Config({
        designatedMaster: lanIpv6?.designatedMaster || '-',
        raServiceMode: lanIpv6?.raServiceMode || '-',
        dhcpv6ServiceMode: lanIpv6?.dhcpv6ServiceMode || '-',
        ndpProxyMode: lanIpv6?.ndpProxyMode || '-',
        dhcpv6Mode: lanIpv6?.dhcpv6Mode || '-',
        alwaysAdvertiseDefaultRoute: lanIpv6?.alwaysAdvertiseDefaultRoute || '-',
        advertisedDnsServers: Array.isArray(lanIpv6?.advertisedDnsServers)
          ? lanIpv6.advertisedDnsServers
          : [],
        advertisedDnsDomains: Array.isArray(lanIpv6?.advertisedDnsDomains)
          ? lanIpv6.advertisedDnsDomains
          : []
      })

      setUpdatedAt(
        new Date().toLocaleTimeString('zh-CN', {
          hour12: false
        })
      )
    } catch (error) {
      setStatusText(error?.message || '读取 LAN/WAN 配置失败，请确认 LuCI 登录态。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadNetworkConfig()
  }, [])

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">网络设置</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">来自 LuCI 网络接口页（LAN/WAN）</p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">LAN 配置</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">协议：{lanConfig.protocol}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">IPv4：{lanConfig.ipv4}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">掩码：{lanConfig.netmask}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">网关：{lanConfig.gateway}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">IPv6 分配长度：{lanConfig.ipv6assign}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">
            IPv6 地址：{lanConfig.ipv6addrs.length ? lanConfig.ipv6addrs.join(' / ') : '-'}
          </p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">IPv6 前缀：{lanConfig.ipv6prefix}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">MTU：{lanConfig.mtu}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">
            DNS：{lanConfig.dns.length ? lanConfig.dns.join(' / ') : '-'}
          </p>
        </section>

        <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">WAN 配置</h3>
          <p className="text-xs text-zinc-500 dark:text-zinc-400">协议：{wanConfig.protocol}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">PPPoE 用户名：{wanConfig.pppoeUsername}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">PPPoE 密码：{wanConfig.pppoePasswordMasked}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">网关：{wanConfig.gateway}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">MTU：{wanConfig.mtu}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">
            DNS：{wanConfig.dns.length ? wanConfig.dns.join(' / ') : '-'}
          </p>
        </section>

        <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">LAN IPv6（DHCP/RA/NDP）</h3>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">Designated master：{lanIpv6Config.designatedMaster}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">路由通告服务：{lanIpv6Config.raServiceMode}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">DHCPv6 服务：{lanIpv6Config.dhcpv6ServiceMode}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">NDP 代理：{lanIpv6Config.ndpProxyMode}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">DHCPv6 模式：{lanIpv6Config.dhcpv6Mode}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">总是通告默认路由：{lanIpv6Config.alwaysAdvertiseDefaultRoute}</p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">
            通告的 DNS 服务器：{lanIpv6Config.advertisedDnsServers.length ? lanIpv6Config.advertisedDnsServers.join(' / ') : '-'}
          </p>
          <p className="text-sm text-zinc-700 dark:text-zinc-200">
            通告的 DNS 域名：{lanIpv6Config.advertisedDnsDomains.length ? lanIpv6Config.advertisedDnsDomains.join(' / ') : '-'}
          </p>
        </section>
      </div>

      <div className="flex flex-wrap items-center justify-between rounded-xl border border-zinc-200 bg-white px-5 py-4 dark:border-zinc-700 dark:bg-zinc-900">
        <p className="text-xs text-zinc-500 dark:text-zinc-400">
          {statusText || `上次更新时间：${updatedAt || '--:--:--'}`}
        </p>
        <button
          className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          disabled={loading}
          onClick={loadNetworkConfig}
          type="button"
        >
          {loading ? '刷新中...' : '刷新配置'}
        </button>
      </div>
    </section>
  )
}

function InstalledPackagesPage() {
  const [packages, setPackages] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [updatedAt, setUpdatedAt] = useState('')
  const [meta, setMeta] = useState({
    total: 0,
    listHint: '',
    freeSpacePercent: '',
    freeSpacePercentValue: 0,
    freeSpaceText: '',
    truncated: false
  })

  const loadPackages = async () => {
    setLoading(true)

    try {
      const result = await fetchInstalledPackages(3000)
      setPackages(result.items || [])
      setMeta({
        total: result.total || 0,
        listHint: result.listHint || '',
        freeSpacePercent: result.freeSpacePercent || '',
        freeSpacePercentValue:
          typeof result.freeSpacePercentValue === 'number' ? result.freeSpacePercentValue : 0,
        freeSpaceText: result.freeSpaceText || '',
        truncated: Boolean(result.truncated)
      })

      const sampleTime = new Date(result.sampledAt || Date.now()).toLocaleTimeString('zh-CN', {
        hour12: false
      })
      setUpdatedAt(sampleTime)
      setStatusText(result.truncated ? '列表过长，已按名称排序后截断展示。' : '')
    } catch (error) {
      setStatusText(error?.message || '读取软件包失败')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    loadPackages()
  }, [])

  const filteredItems = useMemo(() => {
    const keyword = query.trim().toLowerCase()
    if (!keyword) {
      return packages
    }

    return packages.filter((item) => {
      const name = String(item.name || '').toLowerCase()
      const version = String(item.version || '').toLowerCase()
      return name.includes(keyword) || version.includes(keyword)
    })
  }, [packages, query])

  return (
    <section className="space-y-4">
      <div>
        <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">软件包（已安装）</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">来源：/cgi-bin/luci/admin/system/packages?display=installed</p>
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">软件包总数</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{meta.total || 0}</p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">空闲空间</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">
            {meta.freeSpacePercent ? `${meta.freeSpacePercent} (${meta.freeSpaceText || '-'})` : '-'}
          </p>
          <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
            <div
              className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
              style={{ width: `${clamp(meta.freeSpacePercentValue || 0, 0, 100)}%` }}
            />
          </div>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">
            已用 {clamp(100 - (meta.freeSpacePercentValue || 0), 0, 100)}%
          </p>
        </div>

        <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">当前筛选结果</p>
          <p className="mt-1 text-lg font-semibold text-zinc-900 dark:text-zinc-100">{filteredItems.length}</p>
        </div>
      </div>

      <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center gap-3">
          <input
            className="w-full max-w-md rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-900 outline-none transition focus:border-zinc-400 dark:border-zinc-600 dark:bg-zinc-900 dark:text-zinc-100 dark:focus:border-zinc-500"
            onChange={(event) => setQuery(event.target.value)}
            placeholder="按包名或版本筛选"
            type="text"
            value={query}
          />
          <button
            className="rounded-lg border border-zinc-200 bg-white px-3 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
            disabled={loading}
            onClick={loadPackages}
            type="button"
          >
            {loading ? '刷新中...' : '刷新列表'}
          </button>
        </div>

        <p className="mt-3 text-xs text-zinc-500 dark:text-zinc-400">
          {statusText || `上次更新时间：${updatedAt || '--:--:--'}`}
          {meta.listHint ? ` · ${meta.listHint}` : ''}
        </p>
      </div>

      <div className="overflow-auto rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <table className="min-w-full divide-y divide-zinc-200 text-left text-sm">
          <thead className="sticky top-0 bg-zinc-50 text-zinc-500 dark:bg-zinc-800 dark:text-zinc-400">
            <tr>
              <th className="px-4 py-3 font-medium">软件包名称</th>
              <th className="px-4 py-3 font-medium">版本</th>
            </tr>
          </thead>
          <tbody className="divide-y divide-zinc-100 bg-white text-zinc-700 dark:divide-zinc-700 dark:bg-zinc-900 dark:text-zinc-200">
            {filteredItems.length ? (
              filteredItems.map((item) => (
                <tr key={item.id}>
                  <td className="px-4 py-2.5 font-medium text-zinc-900 dark:text-zinc-100">{item.name}</td>
                  <td className="px-4 py-2.5">{item.version}</td>
                </tr>
              ))
            ) : (
              <tr>
                <td className="px-4 py-5 text-zinc-500 dark:text-zinc-400" colSpan={2}>
                  暂无可展示的软件包，请检查登录状态后重试。
                </td>
              </tr>
            )}
          </tbody>
        </table>
      </div>
    </section>
  )
}

function formatUptime(seconds) {
  const total = Math.max(0, Number(seconds) || 0)
  if (!total) {
    return '-'
  }

  const days = Math.floor(total / 86400)
  const hours = Math.floor((total % 86400) / 3600)
  const minutes = Math.floor((total % 3600) / 60)
  const secs = Math.floor(total % 60)

  if (days > 0) {
    return `${days}天 ${hours}小时 ${minutes}分`
  }

  if (hours > 0) {
    return `${hours}小时 ${minutes}分 ${secs}秒`
  }

  if (minutes > 0) {
    return `${minutes}分 ${secs}秒`
  }

  return `${secs}秒`
}

function VpnTrafficCard({ iface, downSeries, upSeries }) {
  const width = 480
  const height = 180
  const [hoverPoint, setHoverPoint] = useState(null)
  const currentDown = downSeries[downSeries.length - 1] ?? 0
  const currentUp = upSeries[upSeries.length - 1] ?? 0
  const bounds = getSeriesBounds([downSeries, upSeries])
  const downPath = createLinePath(downSeries, width, height, bounds.min, bounds.max)
  const upPath = createLinePath(upSeries, width, height, bounds.min, bounds.max)
  const downAreaPath = createAreaPath(downSeries, width, height, bounds.min, bounds.max)

  const handleMove = (event) => {
    const point = getPointByClientX(event, downSeries, width)
    if (!point) {
      setHoverPoint(null)
      return
    }

    setHoverPoint({
      ...point,
      down: Number(downSeries[point.index] || 0),
      up: Number(upSeries[point.index] || 0)
    })
  }

  const handleLeave = () => setHoverPoint(null)

  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-4 flex items-start justify-between gap-4">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">{iface.label} 流量</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">
            接口 {iface.ifname || iface.id} · 协议 {iface.proto || '-'} · 运行 {formatUptime(iface.uptime)}
          </p>
          <div className="mt-2 flex items-center gap-4 text-xs">
            <span className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-200">
              <span className="h-2 w-2 rounded-full bg-sky-500" />
              下行 {formatRate(currentDown)}
            </span>
            <span className="flex items-center gap-1.5 text-zinc-700 dark:text-zinc-200">
              <span className="h-2 w-2 rounded-full bg-violet-500" />
              上行 {formatRate(currentUp)}
            </span>
          </div>
        </div>
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">最近 {downSeries.length} 个采样点</span>
      </div>

      <ChartCanvas>
        <svg className="h-full w-full" preserveAspectRatio="none" viewBox={`0 0 ${width} ${height}`}>
          <defs>
            <linearGradient id={`vpnTrafficFill-${iface.id}`} x1="0" x2="0" y1="0" y2="1">
              <stop offset="0%" stopColor="#0ea5e9" stopOpacity="0.28" />
              <stop offset="100%" stopColor="#0ea5e9" stopOpacity="0" />
            </linearGradient>
          </defs>
          <path d={downAreaPath} fill={`url(#vpnTrafficFill-${iface.id})`} />
          <path d={downPath} fill="none" stroke="#0ea5e9" strokeWidth="2" />
          <path d={upPath} fill="none" stroke="#8b5cf6" strokeWidth="2" />

          {hoverPoint ? (
            <line
              x1={hoverPoint.x}
              x2={hoverPoint.x}
              y1={10}
              y2={height - 10}
              stroke="#64748b"
              strokeDasharray="4 4"
              strokeWidth="1"
            />
          ) : null}
        </svg>

        <div
          className="absolute inset-0"
          onMouseLeave={handleLeave}
          onMouseMove={handleMove}
        />

        {hoverPoint ? (
          <div className="pointer-events-none absolute left-3 top-3 rounded-md bg-zinc-900/90 px-2 py-1 text-xs text-white dark:bg-zinc-100/90 dark:text-zinc-900">
            采样 #{hoverPoint.index + 1} · 下行 {formatRate(hoverPoint.down)} · 上行 {formatRate(hoverPoint.up)}
          </div>
        ) : null}
      </ChartCanvas>

      <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-zinc-600 dark:text-zinc-300 sm:grid-cols-2">
        <span className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800">总接收 {iface.rxHuman}</span>
        <span className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800">总发送 {iface.txHuman}</span>
      </div>
    </section>
  )
}

function OpenClashStatusCard({ status, loading, error }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mb-4 flex items-center justify-between">
        <div>
          <h3 className="text-base font-semibold text-zinc-900 dark:text-zinc-100">OpenClash 实时状态</h3>
          <p className="mt-1 text-xs text-zinc-500 dark:text-zinc-400">来源：/cgi-bin/luci/admin/services/openclash/toolbar_show</p>
        </div>
        <span className="rounded-full bg-zinc-100 px-2.5 py-1 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
          {loading ? '刷新中' : '已刷新'}
        </span>
      </div>

      {error ? (
        <p className="text-sm text-rose-600 dark:text-rose-400">{error}</p>
      ) : status ? (
        <>
          <div className="grid grid-cols-2 gap-3 text-sm sm:grid-cols-4">
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">下行速率</p>
              <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{status.down || '-'}</p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">上行速率</p>
              <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{status.up || '-'}</p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">连接数</p>
              <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{status.connections ?? 0}</p>
            </div>
            <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
              <p className="text-xs text-zinc-500 dark:text-zinc-400">CPU / 内存</p>
              <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{status.cpu || '-'}% / {status.mem || '-'}</p>
            </div>
          </div>

          <div className="mt-3 grid grid-cols-1 gap-2 text-xs text-zinc-600 dark:text-zinc-300 sm:grid-cols-4">
            <span className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800">累计下载 {status.down_total || '-'}</span>
            <span className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800">累计上传 {status.up_total || '-'}</span>
            <span className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800">负载 {status.load_avg || '-'}</span>
            <span className="rounded-md bg-zinc-100 px-2 py-1 dark:bg-zinc-800">采样 {status.sampledAtText || '--:--:--'}</span>
          </div>
        </>
      ) : (
        <p className="text-sm text-zinc-500 dark:text-zinc-400">暂无 OpenClash 数据。</p>
      )}
    </section>
  )
}

function VpnPage({ credentials, authState }) {
  const [ifaceCards, setIfaceCards] = useState([])
  const [statusText, setStatusText] = useState('')
  const [loading, setLoading] = useState(false)
  const [openClash, setOpenClash] = useState(null)
  const [openClashAvailable, setOpenClashAvailable] = useState(false)
  const [openClashLoading, setOpenClashLoading] = useState(false)
  const [openClashError, setOpenClashError] = useState('')

  const loadVpnData = async () => {
    try {
      setRouterAddress(credentials.address)
    } catch {
      setStatusText('请先输入正确的路由器地址，再刷新 VPN 数据。')
      return
    }

    setLoading(true)
    setStatusText('')

    try {
      const rows = await fetchInterfaceStatusBatch(['EasyTier', 'tailscale'])
      const now = Date.now()

      setIfaceCards((previous) => {
        return rows.map((row) => {
          const prev = previous.find((item) => item.id === row.id)
          const prevSample = prev?.sample
          const elapsedSeconds = prevSample && now > prevSample.sampledAt
            ? Math.max(1, (now - prevSample.sampledAt) / 1000)
            : null

          const downMbps =
            prevSample && elapsedSeconds && row.rxBytes >= prevSample.rxBytes
              ? Math.max(0, ((row.rxBytes - prevSample.rxBytes) * 8) / elapsedSeconds / 1_000_000)
              : 0

          const upMbps =
            prevSample && elapsedSeconds && row.txBytes >= prevSample.txBytes
              ? Math.max(0, ((row.txBytes - prevSample.txBytes) * 8) / elapsedSeconds / 1_000_000)
              : 0

          return {
            id: row.id,
            label: String(row.id || '').toLowerCase() === 'easytier' ? 'EasyTier' : 'Tailscale',
            ifname: row.ifname,
            proto: row.proto,
            uptime: row.uptime,
            rxHuman: `${(row.rxBytes / 1024 / 1024).toFixed(1)} MB`,
            txHuman: `${(row.txBytes / 1024 / 1024).toFixed(1)} MB`,
            downSeries: pushAndTrim(prev?.downSeries || createSeries(CHART_SERIES_LENGTH, () => 0), downMbps),
            upSeries: pushAndTrim(prev?.upSeries || createSeries(CHART_SERIES_LENGTH, () => 0), upMbps),
            sample: {
              rxBytes: row.rxBytes,
              txBytes: row.txBytes,
              sampledAt: now
            }
          }
        })
      })

      if (!rows.length) {
        setStatusText('未检测到 EasyTier 或 Tailscale 接口，已隐藏对应 VPN 图表。')
      }
    } catch (error) {
      setStatusText(error?.message || '读取 VPN 接口状态失败。')
      setIfaceCards([])
    } finally {
      setLoading(false)
    }
  }

  const loadOpenClashStatus = async () => {
    try {
      setRouterAddress(credentials.address)
    } catch {
      setOpenClashError('请先输入正确的路由器地址，再刷新 OpenClash 数据。')
      return
    }

    setOpenClashLoading(true)
    setOpenClashError('')

    try {
      const data = await fetchOpenClashToolbarStatus()
      setOpenClash({
        down: typeof data.downRaw === 'string' && data.downRaw ? data.downRaw : `${data.downRateMbps.toFixed(2)} Mbps`,
        up: typeof data.upRaw === 'string' && data.upRaw ? data.upRaw : `${data.upRateMbps.toFixed(2)} Mbps`,
        down_total: data.downTotal,
        up_total: data.upTotal,
        connections: data.connections,
        load_avg: data.loadAvg,
        mem: data.mem,
        cpu: data.cpu,
        sampledAtText: new Date(data.sampledAt).toLocaleTimeString('zh-CN', { hour12: false })
      })
      setOpenClashAvailable(true)
    } catch (error) {
      setOpenClashError(error?.message || '读取 OpenClash 数据失败。')
    } finally {
      setOpenClashLoading(false)
    }
  }

  useEffect(() => {
    if (!authState.authenticated || !authState.luciAuthenticated) {
      setIfaceCards([])
      setStatusText('未登录路由器，无法读取 VPN 数据。')
      setOpenClash(null)
      setOpenClashAvailable(false)
      return
    }

    loadVpnData()
    loadOpenClashStatus()

    const timer = window.setInterval(() => {
      loadVpnData()
      loadOpenClashStatus()
    }, 2000)

    return () => window.clearInterval(timer)
  }, [authState.authenticated, authState.luciAuthenticated, credentials.address])

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">VPN</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">自动检测 EasyTier / Tailscale，并展示实时流量走势</p>
        </div>
        <button
          className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          disabled={loading || openClashLoading}
          onClick={() => {
            loadVpnData()
            loadOpenClashStatus()
          }}
          type="button"
        >
          {loading || openClashLoading ? '刷新中...' : '刷新 VPN 数据'}
        </button>
      </div>

      {openClashAvailable ? <OpenClashStatusCard error={openClashError} loading={openClashLoading} status={openClash} /> : null}

      {ifaceCards.length ? (
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          {ifaceCards.map((iface) => (
            <VpnTrafficCard
              key={iface.id}
              downSeries={iface.downSeries}
              iface={iface}
              upSeries={iface.upSeries}
            />
          ))}
        </div>
      ) : (
        <section className="rounded-xl border border-zinc-200 bg-white p-6 text-sm text-zinc-500 dark:border-zinc-700 dark:bg-zinc-900 dark:text-zinc-400">
          未检测到可展示流量图的 VPN 接口（EasyTier / Tailscale）。
        </section>
      )}

      <p className="text-xs text-zinc-500 dark:text-zinc-400">{statusText || 'VPN 数据每 2 秒自动刷新一次。'}</p>
    </section>
  )
}

function PluginsPage({ credentials, authState }) {
  const [loading, setLoading] = useState(false)
  const [statusText, setStatusText] = useState('')
  const [updatedAt, setUpdatedAt] = useState('')
  const [adgConfig, setAdgConfig] = useState({
    enabled: false,
    httpPort: '-',
    redirectMode: '-',
    coreVersion: '-',
    binPath: '-',
    configPath: '-',
    workDir: '-',
    logFile: '-',
    verbose: false,
    waitOnBoot: false,
    backupFiles: [],
    backupWorkDirPath: '-'
  })
  const [adgStatus, setAdgStatus] = useState({
    running: false,
    redirected: false
  })
  const [ddnsConfig, setDdnsConfig] = useState({
    enabled: false,
    port: '-',
    updateInterval: '-',
    compareTimes: '-',
    skipVerify: false,
    dnsServer: '-',
    noWeb: false,
    delay: '-',
    description: ''
  })
  const [ddnsStatus, setDdnsStatus] = useState({
    running: false
  })
  const [appFilter, setAppFilter] = useState({
    runningStatus: '-',
    workMode: '-',
    recordEnabled: '-'
  })

  const loadPlugins = async () => {
    try {
      setRouterAddress(credentials.address)
    } catch {
      setStatusText('请先输入正确的路由器地址，再刷新插件信息。')
      return
    }

    setLoading(true)
    setStatusText('')

    try {
      const [config, status, ddns, ddnsStatus, appFilterStatus] = await Promise.all([
        fetchAdGuardHomeConfig(),
        fetchAdGuardHomeStatus().catch(() => ({ running: false, redirected: false })),
        fetchDdnsGoConfig().catch(() => null),
        fetchDdnsGoStatus().catch(() => ({ running: false })),
        fetchAppFilterStatus().catch(() => ({ runningStatus: '-', workMode: '-', recordEnabled: '-' }))
      ])

      setAdgConfig({
        enabled: Boolean(config.enabled),
        httpPort: config.httpPort || '-',
        redirectMode: config.redirectMode || '-',
        coreVersion: config.coreVersion || '-',
        binPath: config.binPath || '-',
        configPath: config.configPath || '-',
        workDir: config.workDir || '-',
        logFile: config.logFile || '-',
        verbose: Boolean(config.verbose),
        waitOnBoot: Boolean(config.waitOnBoot),
        backupFiles: Array.isArray(config.backupFiles) ? config.backupFiles : [],
        backupWorkDirPath: config.backupWorkDirPath || '-'
      })

      setAdgStatus({
        running: Boolean(status.running),
        redirected: Boolean(status.redirected)
      })

      setDdnsConfig({
        enabled: Boolean(ddns?.enabled),
        port: ddns?.port || '-',
        updateInterval: ddns?.updateInterval || '-',
        compareTimes: ddns?.compareTimes || '-',
        skipVerify: Boolean(ddns?.skipVerify),
        dnsServer: ddns?.dnsServer || '-',
        noWeb: Boolean(ddns?.noWeb),
        delay: ddns?.delay || '-',
        description: ddns?.description || ''
      })

      setDdnsStatus({
        running: Boolean(ddnsStatus?.running)
      })

      setAppFilter({
        runningStatus: appFilterStatus?.runningStatus || '-',
        workMode: appFilterStatus?.workMode || '-',
        recordEnabled: appFilterStatus?.recordEnabled || '-'
      })

      setUpdatedAt(
        new Date().toLocaleTimeString('zh-CN', {
          hour12: false
        })
      )
    } catch (error) {
      setStatusText(error?.message || '读取 AdGuardHome 配置失败，请确认 LuCI 登录态与插件安装状态。')
    } finally {
      setLoading(false)
    }
  }

  useEffect(() => {
    if (!authState.authenticated || !authState.luciAuthenticated) {
      setStatusText('未登录路由器，无法读取插件信息。')
      return
    }

    loadPlugins()
  }, [authState.authenticated, authState.luciAuthenticated, credentials.address])

  return (
    <section className="space-y-6">
      <div className="flex flex-wrap items-end justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">插件</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">LuCI 服务页面</p>
        </div>
        <button
          className="rounded-lg border border-zinc-200 bg-white px-4 py-2 text-sm text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          disabled={loading}
          onClick={loadPlugins}
          type="button"
        >
          {loading ? '刷新中...' : '刷新插件信息'}
        </button>
      </div>

      <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">AdGuardHome 状态</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2.5 py-1 font-medium ${
                adgConfig.enabled
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              {adgConfig.enabled ? '已启用' : '未启用'}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 font-medium ${
                adgStatus.running
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
              }`}
            >
              {adgStatus.running ? '运行中' : '未运行'}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 font-medium ${
                adgStatus.redirected
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              {adgStatus.redirected ? '已重定向' : '未重定向'}
            </span>
          </div>
        </div>

        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 xl:grid-cols-3">
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">核心版本</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{adgConfig.coreVersion}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">网页管理端口</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{adgConfig.httpPort}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">6060 重定向</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{adgConfig.redirectMode}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">执行文件路径</p>
            <p className="mt-1 truncate font-semibold text-zinc-900 dark:text-zinc-100" title={adgConfig.binPath}>{adgConfig.binPath}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">配置文件路径</p>
            <p className="mt-1 truncate font-semibold text-zinc-900 dark:text-zinc-100" title={adgConfig.configPath}>{adgConfig.configPath}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">工作目录</p>
            <p className="mt-1 truncate font-semibold text-zinc-900 dark:text-zinc-100" title={adgConfig.workDir}>{adgConfig.workDir}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">运行日志</p>
            <p className="mt-1 truncate font-semibold text-zinc-900 dark:text-zinc-100" title={adgConfig.logFile}>{adgConfig.logFile}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">详细日志</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{adgConfig.verbose ? '已启用' : '未启用'}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">开机后网络准备好时重启</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{adgConfig.waitOnBoot ? '已启用' : '未启用'}</p>
          </div>
        </div>

        <div className="rounded-lg border border-zinc-200 bg-zinc-50 p-3 dark:border-zinc-700 dark:bg-zinc-800">
          <p className="text-xs text-zinc-500 dark:text-zinc-400">关机备份文件</p>
          <p className="mt-1 text-sm font-semibold text-zinc-900 dark:text-zinc-100">
            {adgConfig.backupFiles.length ? adgConfig.backupFiles.join(' / ') : '-'}
          </p>
          <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">备份路径：{adgConfig.backupWorkDirPath}</p>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">应用过滤</h3>
        </div>

        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-3">
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">运行状态</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{appFilter.runningStatus}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">工作模式</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{appFilter.workMode}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">应用记录</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{appFilter.recordEnabled}</p>
          </div>
        </div>
      </section>

      <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900">
        <div className="flex flex-wrap items-center justify-between gap-3">
          <h3 className="text-sm font-semibold text-zinc-900 dark:text-zinc-100">DDNS-GO 状态</h3>
          <div className="flex flex-wrap items-center gap-2 text-xs">
            <span
              className={`rounded-full px-2.5 py-1 font-medium ${
                ddnsConfig.enabled
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-zinc-100 text-zinc-700 dark:bg-zinc-800 dark:text-zinc-300'
              }`}
            >
              {ddnsConfig.enabled ? '已启用' : '未启用'}
            </span>
            <span
              className={`rounded-full px-2.5 py-1 font-medium ${
                ddnsStatus.running
                  ? 'bg-emerald-50 text-emerald-700 dark:bg-emerald-900/30 dark:text-emerald-300'
                  : 'bg-rose-50 text-rose-700 dark:bg-rose-900/30 dark:text-rose-300'
              }`}
            >
              {ddnsStatus.running ? '服务已启动' : '服务未启动'}
            </span>
          </div>
        </div>

        {ddnsConfig.description ? (
          <p className="rounded-lg bg-zinc-50 px-3 py-2 text-xs text-zinc-600 dark:bg-zinc-800 dark:text-zinc-300">
            {ddnsConfig.description}
          </p>
        ) : null}

        <div className="grid grid-cols-1 gap-3 text-sm sm:grid-cols-2 xl:grid-cols-4">
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">访问端口</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{ddnsConfig.port}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">更新间隔</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{ddnsConfig.updateInterval}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">间隔 N 次与服务商比对</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{ddnsConfig.compareTimes}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">指定 DNS 服务器</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{ddnsConfig.dnsServer}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">跳过证书验证</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{ddnsConfig.skipVerify ? '是' : '否'}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">不启动 Web 服务</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{ddnsConfig.noWeb ? '是' : '否'}</p>
          </div>
          <div className="rounded-lg bg-zinc-50 p-3 dark:bg-zinc-800">
            <p className="text-xs text-zinc-500 dark:text-zinc-400">开机延时启动（秒）</p>
            <p className="mt-1 font-semibold text-zinc-900 dark:text-zinc-100">{ddnsConfig.delay}</p>
          </div>
        </div>
      </section>

      <p className="text-xs text-zinc-500 dark:text-zinc-400">{statusText || `上次更新时间：${updatedAt || '--:--:--'}`}</p>
    </section>
  )
}

function ServicesPage({ credentials }) {
  const [topProcesses, setTopProcesses] = useState([])
  const [processesUpdatedAt, setProcessesUpdatedAt] = useState('')
  const [processesLoading, setProcessesLoading] = useState(false)
  const [processesStatus, setProcessesStatus] = useState('')
  const [startupItems, setStartupItems] = useState([])
  const [startupUpdatedAt, setStartupUpdatedAt] = useState('')
  const [startupLoading, setStartupLoading] = useState(false)
  const [startupStatus, setStartupStatus] = useState('')

  const loadTopProcesses = async () => {
    try {
      setRouterAddress(credentials.address)
    } catch {
      setProcessesStatus('请先输入正确的路由器地址，再刷新进程列表。')
      return
    }

    setProcessesLoading(true)
    setProcessesStatus('')

    try {
      const payload = await fetchTopProcesses()
      setTopProcesses(payload.items)
      setProcessesUpdatedAt(
        new Date(payload.sampledAt).toLocaleTimeString('zh-CN', {
          hour12: false
        })
      )
    } catch {
      setProcessesStatus('读取进程列表失败，请确认 LuCI 登录态与页面访问权限。')
    } finally {
      setProcessesLoading(false)
    }
  }

  const loadStartupItems = async () => {
    try {
      setRouterAddress(credentials.address)
    } catch {
      setStartupStatus('请先输入正确的路由器地址，再刷新启动项。')
      return
    }

    setStartupLoading(true)
    setStartupStatus('')

    try {
      const payload = await fetchStartupEntries(300)
      setStartupItems(payload.items)
      setStartupUpdatedAt(
        new Date(payload.sampledAt).toLocaleTimeString('zh-CN', {
          hour12: false
        })
      )
    } catch {
      setStartupStatus('读取启动项失败，请确认 LuCI 登录态与访问权限。')
    } finally {
      setStartupLoading(false)
    }
  }

  useEffect(() => {
    loadTopProcesses()
    loadStartupItems()
  }, [credentials.address])

  return (
    <section className="space-y-6">
      <div>
        <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">服务</h2>
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">系统进程与启动项（左右排布）</p>
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <ProcessTopCard
          loading={processesLoading}
          onRefresh={loadTopProcesses}
          processes={topProcesses}
          statusText={processesStatus}
          updatedAt={processesUpdatedAt}
        />

        <StartupItemsCard
          items={startupItems}
          loading={startupLoading}
          onRefresh={loadStartupItems}
          statusText={startupStatus}
          updatedAt={startupUpdatedAt}
        />
      </div>
    </section>
  )
}

function PlaceholderPage({ title, description }) {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-8 dark:border-zinc-700 dark:bg-zinc-900">
      <div className="mx-auto max-w-xl text-center">
        <div className="mx-auto mb-5 flex h-28 w-28 items-center justify-center rounded-3xl bg-zinc-100 dark:bg-zinc-800/80">
          <svg
            aria-hidden="true"
            className="h-20 w-20 text-zinc-500 dark:text-zinc-300"
            fill="none"
            viewBox="0 0 96 96"
            xmlns="http://www.w3.org/2000/svg"
          >
            <rect x="14" y="12" width="68" height="72" rx="10" stroke="currentColor" strokeWidth="4" />
            <path d="M28 32h40M28 46h24" stroke="currentColor" strokeLinecap="round" strokeWidth="4" />
            <circle cx="66" cy="62" r="11" stroke="currentColor" strokeWidth="4" />
            <path d="M63 62l2.5 2.5L70 60" stroke="currentColor" strokeLinecap="round" strokeLinejoin="round" strokeWidth="4" />
            <path d="M33 78l30-30" stroke="currentColor" strokeLinecap="round" strokeWidth="4" opacity="0.35" />
          </svg>
        </div>

        <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">{title}</h2>
        <p className="mt-3 text-zinc-600 dark:text-zinc-300">{description}</p>

        <div className="mt-6 inline-flex items-center rounded-full border border-amber-300 bg-amber-50 px-4 py-2 text-sm font-medium text-amber-700 dark:border-amber-800/70 dark:bg-amber-900/20 dark:text-amber-300">
          功能未实现，敬请期待
        </div>
      </div>
    </section>
  )
}

function TerminalPage({ ttydUrl }) {
  return (
    <section className="space-y-4">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <div>
          <h2 className="text-2xl font-semibold text-zinc-900 dark:text-zinc-100">终端</h2>
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">连接 TTYD：{ttydUrl}</p>
        </div>
        <a
          className="rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
          href={ttydUrl}
          rel="noreferrer"
          target="_blank"
        >
          新窗口打开
        </a>
      </div>

      <div className="overflow-hidden rounded-xl border border-zinc-200 bg-white dark:border-zinc-700 dark:bg-zinc-900">
        <iframe
          className="h-[74vh] w-full bg-black"
          src={ttydUrl}
          title="TTYD 终端"
        />
      </div>
    </section>
  )
}


function App() {
  const [activePage, setActivePage] = useState('dashboard')
  const [sidebarOpen, setSidebarOpen] = useState(false)
  const [settingsOpen, setSettingsOpen] = useState(false)
  const [aboutOpen, setAboutOpen] = useState(false)
  const [hasPromptedLogin, setHasPromptedLogin] = useState(false)
  const { theme, isDark, setTheme } = useTheme()
  const {
    authState,
    credentials,
    authLoading,
    authMessage,
    successToast,
    setSuccessToast,
    diagnostics,
    diagnosticsLoading,
    autoLoginTried,
    handleAuthInput,
    handleLogin,
    handleLogout,
    runDiagnostics
  } = useRouterAuth(ROUTER_DEFAULTS)
  const ttydUrl = useMemo(() => {
    const sourceAddress = String(
      credentials.address || authState.address || ROUTER_DEFAULTS.address || 'http://192.168.1.1'
    ).trim()

    try {
      const parsed = new URL(/^https?:\/\//i.test(sourceAddress) ? sourceAddress : `http://${sourceAddress}`)
      const scheme = parsed.protocol === 'https:' ? 'https' : 'http'
      const rawHost = parsed.hostname || '192.168.1.1'
      const host = rawHost.includes(':') && !rawHost.startsWith('[') ? `[${rawHost}]` : rawHost
      return `${scheme}://${host}:7681`
    } catch {
      return 'http://192.168.1.1:7681'
    }
  }, [authState.address, credentials.address])
  const luciQuickUrl = `http://${String(credentials.address || '')
    .replace(/^https?:\/\//i, '')
    .replace(/\/$/, '')}/cgi-bin/luci?luci_username=root&luci_password=${encodeURIComponent(credentials.password || '')}`

  useEffect(() => {
    if (autoLoginTried) {
      return undefined
    }

    let cancelled = false

    const runAutoLogin = async () => {
      // auto-login 逻辑已由 useRouterAuth 负责
    }

    runAutoLogin()

    return () => {
      cancelled = true
    }
  }, [autoLoginTried, credentials.address, credentials.password])

  useEffect(() => {
    if (!autoLoginTried) {
      return
    }

    if ((!authState.authenticated || !authState.luciAuthenticated) && !hasPromptedLogin) {
      setSettingsOpen(true)
      setHasPromptedLogin(true)
    }
  }, [authState.authenticated, authState.luciAuthenticated, hasPromptedLogin, autoLoginTried])

  const handleThemeChange = (event) => {
    const next = event.target.value
    if (next === 'system' || next === 'light' || next === 'dark') {
      setTheme(next)
    }
  }

  const toggleTheme = () => {
    setTheme((previous) => {
      if (previous === 'system') {
        return isDark ? 'light' : 'dark'
      }

      return previous === 'dark' ? 'light' : 'dark'
    })
  }

  const currentLabel = useMemo(() => {
    const found = NAV_ITEMS.find((item) => item.id === activePage)
    return found?.label ?? 'Dashboard'
  }, [activePage])

  const closeSidebar = () => setSidebarOpen(false)

  const renderContent = () => {
    if (activePage === 'dashboard') {
      return <Dashboard authState={authState} credentials={credentials} />
    }

    if (activePage === 'network') {
      return <NetworkSettingsPage />
    }

    if (activePage === 'terminal') {
      return <TerminalPage ttydUrl={ttydUrl} />
    }

    if (activePage === 'packages') {
      return <InstalledPackagesPage />
    }

    if (activePage === 'services') {
      return <ServicesPage credentials={credentials} />
    }

    if (activePage === 'plugins') {
      return <PluginsPage authState={authState} credentials={credentials} />
    }

    if (activePage === 'vpn') {
      return <VpnPage authState={authState} credentials={credentials} />
    }

    const page = PAGE_CONTENT[activePage]
    return <PlaceholderPage title={page.title} description={page.description} />
  }

  return (
    <div className="min-h-screen bg-zinc-50 text-zinc-900 dark:bg-zinc-950 dark:text-zinc-100">
      {sidebarOpen ? (
        <button
          aria-label="关闭侧边栏遮罩"
          className="fixed inset-0 z-30 bg-black/30 lg:hidden"
          onClick={closeSidebar}
          type="button"
        />
      ) : null}

      <SettingsModal
        authLoading={authLoading}
        authMessage={authMessage}
        authState={authState}
        credentials={credentials}
        diagnostics={diagnostics}
        diagnosticsLoading={diagnosticsLoading}
        theme={theme}
        onClose={() => setSettingsOpen(false)}
        onCredentialChange={handleAuthInput}
        onLogin={handleLogin}
        onLogout={handleLogout}
        onRunDiagnostics={runDiagnostics}
        onThemeChange={handleThemeChange}
        onToggleTheme={toggleTheme}
        open={settingsOpen}
      />

      <AboutModal open={aboutOpen} onClose={() => setAboutOpen(false)} />

      {successToast ? (
        <div className="fixed right-4 top-4 z-[60] rounded-lg border border-emerald-200 bg-emerald-50 px-3 py-2 text-sm font-medium text-emerald-700 shadow-lg dark:border-emerald-900/50 dark:bg-emerald-950/50 dark:text-emerald-300">
          {successToast}
        </div>
      ) : null}

      <aside
        className={`fixed inset-y-0 left-0 z-40 w-64 border-r border-zinc-200 bg-white transition-transform duration-200 dark:border-zinc-700 dark:bg-zinc-900 lg:translate-x-0 ${
          sidebarOpen ? 'translate-x-0' : '-translate-x-full'
        }`}
      >
        <div className="flex h-16 items-center justify-between border-b border-zinc-200 px-5 dark:border-zinc-700">
          <div className="flex items-center gap-2">
            <span className="text-lg">⚡</span>
            <span className="text-sm font-semibold tracking-wide">Next-ui </span>
          </div>
          <button
            aria-label="关闭侧边栏"
            className="rounded-md p-1 text-zinc-500 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 lg:hidden"
            onClick={closeSidebar}
            type="button"
          >
            <X size={18} />
          </button>
        </div>

        <nav className="p-3">
          {NAV_ITEMS.map((item) => {
            const Icon = item.icon
            const isActive = activePage === item.id

            return (
              <button
                key={item.id}
                className={`mb-1 flex w-full items-center gap-3 rounded-lg px-3 py-2.5 text-left text-sm transition-colors ${
                  isActive
                    ? 'bg-zinc-100 font-medium text-zinc-900 dark:bg-zinc-800 dark:text-zinc-100'
                    : 'text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800'
                }`}
                onClick={() => {
                  if (activePage !== item.id) {
                    setActivePage(item.id)
                  }
                  closeSidebar()
                }}
                type="button"
              >
                <Icon size={16} />
                <span>{item.label}</span>
              </button>
            )
          })}
        </nav>
      </aside>

      <div className="lg:pl-64">
        <header className="sticky top-0 z-20 flex h-16 items-center justify-between border-b border-zinc-200 bg-white px-4 dark:border-zinc-700 dark:bg-zinc-900 sm:px-6">
          <div className="flex items-center gap-3">
            <button
              aria-label="打开侧边栏"
              className="rounded-md p-2 text-zinc-600 hover:bg-zinc-100 dark:text-zinc-300 dark:hover:bg-zinc-800 lg:hidden"
              onClick={() => setSidebarOpen(true)}
              type="button"
            >
              <Menu size={18} />
            </button>
            <div>
              <p className="text-sm text-zinc-500 dark:text-zinc-400">路由器名称</p>
              <p className="text-sm font-medium text-zinc-900 dark:text-zinc-100">LEDE-Router · {currentLabel}</p>
            </div>
          </div>

          <div className="flex items-center gap-2">
            <a
              className="hidden rounded-lg border border-zinc-200 bg-white px-3 py-1.5 text-xs text-zinc-700 transition hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700 sm:block"
              href={luciQuickUrl}
              rel="noreferrer"
              target="_blank"
              title={luciQuickUrl}
            >
              LuCI 入口
            </a>

            <button
              aria-label="关于 next-ui"
              className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              onClick={() => setAboutOpen(true)}
              type="button"
            >
              <Info size={18} />
            </button>

            <button
              aria-label="用户设置"
              className="rounded-lg border border-zinc-200 bg-white p-2 text-zinc-600 hover:bg-zinc-100 dark:border-zinc-600 dark:bg-zinc-800 dark:text-zinc-200 dark:hover:bg-zinc-700"
              onClick={() => setSettingsOpen(true)}
              type="button"
            >
              <Settings size={18} />
            </button>
          </div>
        </header>

        <div className="border-b border-zinc-200 bg-amber-50/70 px-4 py-2 text-xs text-amber-800 dark:border-zinc-700 dark:bg-amber-500/10 dark:text-amber-300 sm:px-6">
          安全提醒：LuCI URL 传参仅建议在内网或 HTTPS 环境使用。
        </div>

        <main className="p-8">
          <div className="animate-content-fade" key={activePage}>
            {renderContent()}
          </div>
        </main>
      </div>
    </div>
  )
}

export default App
