import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  Gauge,
  HardDrive,
  Cpu,
  Activity,
  MemoryStick,
  ArrowUp,
  ArrowDown,
  Network
} from 'lucide-react'
import {
  fetchIfaceTrafficRates,
  fetchPackagesStorageMeta,
  fetchPublicNetworkAddresses,
  fetchOverviewStatus
} from '../api/router'
import { Skeleton, SkeletonTextBlock } from '../components/Skeleton'

const CHART_SERIES_LENGTH = 240

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


function DashboardCardSkeleton({ lines = 3 }) {
  return (
    <div className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900" aria-hidden="true">
      <Skeleton className="h-4 w-28" />
      <div className="mt-3 space-y-2">
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton className="h-3.5 w-full" key={index} />
        ))}
      </div>
    </div>
  )
}

function DashboardChartSkeleton() {
  return (
    <section className="rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900" aria-hidden="true">
      <Skeleton className="h-4 w-40" />
      <Skeleton className="mt-2 h-3 w-56" />
      <Skeleton className="mt-4 h-44 w-full" />
    </section>
  )
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

      <p className="mt-2 text-xs text-zinc-500 dark:text-zinc-400">已用 {usedPercent}% · Overlay 可写分区</p>

      <div className="mt-3 h-2 overflow-hidden rounded-full bg-zinc-100 dark:bg-zinc-800">
        <div
          className="h-full rounded-full bg-gradient-to-r from-emerald-500 to-emerald-400 transition-all duration-700"
          style={{ width: `${safePercent}%` }}
        />
      </div>
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

export function DashboardPage({ authState, credentials }) {
  const [liveConnections, setLiveConnections] = useState(CONNECTION_SERIES)
  const [liveDown, setLiveDown] = useState(TRAFFIC_DOWN_SERIES)
  const [liveUp, setLiveUp] = useState(TRAFFIC_UP_SERIES)
  const [systemMetrics, setSystemMetrics] = useState(DEFAULT_SYSTEM_METRICS)
  const [lastUpdated, setLastUpdated] = useState('')
  const [arpDevices, setArpDevices] = useState([])
  const [dhcpv6Devices, setDhcpv6Devices] = useState([])
  const [loadedOnce, setLoadedOnce] = useState(false)

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
        setLoadedOnce(true)
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

    setLoadedOnce(false)
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
        {loadedOnce ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">LEDE 路由器核心状态监控</p>
        ) : (
          <div className="mt-2 max-w-sm">
            <SkeletonTextBlock lines={1} />
          </div>
        )}
      </div>

      {!loadedOnce ? (
        <>
      <section className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900" aria-hidden="true">
        <Skeleton className="h-3.5 w-72" />
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DashboardCardSkeleton lines={2} />
        <DashboardCardSkeleton lines={2} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <DashboardCardSkeleton lines={4} />
        <DashboardCardSkeleton lines={4} />
        <DashboardCardSkeleton lines={4} />
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-3">
        <DashboardCardSkeleton lines={4} />
        <DashboardCardSkeleton lines={4} />
        <DashboardCardSkeleton lines={6} />
      </div>

      <section className="space-y-4 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900" aria-hidden="true">
        <Skeleton className="h-4 w-40" />
        <Skeleton className="h-3 w-60" />
        <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
          <DashboardChartSkeleton />
          <DashboardChartSkeleton />
        </div>
      </section>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        <DashboardCardSkeleton lines={7} />
        <DashboardCardSkeleton lines={7} />
      </div>
        </>
      ) : (
        <>
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

        </>
      )}
    </section>
  )
}
