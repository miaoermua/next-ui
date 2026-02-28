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
  fetchDhcpLanIpv6Config,
  fetchIfaceTrafficRates,
  fetchInterfaceStatusByName,
  fetchNetworkLanConfig,
  fetchNetworkWanConfig,
  fetchPackagesStorageMeta,
  fetchPublicNetworkAddresses,
  fetchOverviewStatus,
  getRouterDefaults,
  setRouterAddress
} from './api/router'
import { useTheme } from './hooks/useTheme'
import { useRouterAuth } from './hooks/useRouterAuth'
import { ServicesPage } from './pages/ServicesPage'
import { PluginsPage } from './pages/PluginsPage'
import { VpnPage } from './pages/VpnPage'
import { InstalledPackagesPage } from './pages/PackagesPage'
import { TerminalPage } from './pages/TerminalPage'

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

  const cleanLabel = (value) => {
    return String(value || '')
      .replace(/\(R\)|\(TM\)/gi, '')
      .replace(/\s+CPU\b/gi, '')
      .replace(/\s*@\s*[\d.]+\s*GHz\b/gi, '')
      .replace(/\s+\d+C\d+T.*$/i, '')
      .replace(/[）)]/g, ' ')
      .replace(/^[\s\-–—]+/, '')
      .replace(/[\s\-–—]+$/, '')
      .replace(/\s+/g, ' ')
      .trim()
  }

  const vendorPattern = /(?:AMD|Intel)[^,;|/()（）]*/gi
  const vendorMatches = [...source.matchAll(vendorPattern)]
    .map((item) => cleanLabel(item[0]))
    .filter(Boolean)

  if (vendorMatches.length) {
    return vendorMatches[0]
  }

  const socMatch = source.match(/\b(?:MT\d{4,5}[A-Za-z0-9\-]*|IPQ\d+[A-Za-z0-9\-]*|BCM\d+[A-Za-z0-9\-]*|RK\d+[A-Za-z0-9\-]*)\b/i)
  if (socMatch?.[0]) {
    const normalized = cleanLabel(socMatch[0])
    if (normalized) {
      return normalized
    }
  }

  const snippet = source
    .split(/\s*[：:|／/]\s*|\s+\(CpuMark\b/i)[0]
    .trim()

  return cleanLabel(snippet) || cleanLabel(source) || fallback
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
    let dynamicPending = false
    let staticPending = false

    if (!authState.authenticated) {
      return () => {
        cancelled = true
      }
    }

    const updateDynamicMetrics = async () => {
      if (!authState.authenticated || dynamicPending) {
        return
      }

      dynamicPending = true

      try {
        const [overview, ifaceRates] = await Promise.all([
          fetchOverviewStatus(),
          fetchIfaceTrafficRates()
        ])

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
      } finally {
        dynamicPending = false
      }
    }

    const updateStaticMetrics = async () => {
      if (!authState.authenticated || staticPending) {
        return
      }

      staticPending = true

      try {
        const [storageMetaResult, publicNetworkResult] = await Promise.allSettled([
          fetchPackagesStorageMeta(),
          fetchPublicNetworkAddresses()
        ])

        if (cancelled) {
          return
        }

        const storageMeta = storageMetaResult.status === 'fulfilled' ? storageMetaResult.value : null
        const publicNetwork = publicNetworkResult.status === 'fulfilled' ? publicNetworkResult.value : null

        if (!storageMeta && !publicNetwork) {
          return
        }

        setSystemMetrics((previous) => ({
          ...previous,
          overlayFreePercent:
            typeof storageMeta?.freeSpacePercentValue === 'number'
              ? storageMeta.freeSpacePercentValue
              : previous.overlayFreePercent,
          overlayFreeText: storageMeta?.freeSpaceText || previous.overlayFreeText,
          publicIpv4: publicNetwork?.ipv4 || previous.publicIpv4,
          publicIpv6: publicNetwork?.ipv6 || previous.publicIpv6
        }))
      } catch {
        if (cancelled) {
          return
        }
      } finally {
        staticPending = false
      }
    }

    updateDynamicMetrics()
    updateStaticMetrics()

    const dynamicTimer = window.setInterval(updateDynamicMetrics, 1800)
    const staticTimer = window.setInterval(updateStaticMetrics, 15_000)

    return () => {
      cancelled = true
      window.clearInterval(dynamicTimer)
      window.clearInterval(staticTimer)
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
