import { useEffect, useState } from 'preact/hooks'
import {
  fetchInterfaceStatusBatch,
  fetchOpenClashToolbarStatus,
  setRouterAddress
} from '../api/router'

const CHART_SERIES_LENGTH = 240

function createSeries(length, generator) {
  return Array.from({ length }, (_, index) => generator(index))
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

function ChartCanvas({ children }) {
  return (
    <div className="relative h-44 rounded-lg border border-zinc-200 bg-zinc-50 dark:border-zinc-700 dark:bg-zinc-950/60">
      <div className="absolute inset-x-3 top-2 z-10 flex justify-between text-[10px] uppercase tracking-wide text-zinc-400">
        <span>新</span>
        <span>旧</span>
      </div>
      <div className="absolute inset-0 p-2">{children}</div>
    </div>
  )
}

function getPointByClientX(event, series, width, points = series.length) {
  if (!series.length || points <= 0) {
    return null
  }

  const rect = event.currentTarget.getBoundingClientRect()
  const relativeX = event.clientX - rect.left
  const clampedX = Math.max(0, Math.min(rect.width, relativeX))
  const ratio = rect.width > 0 ? clampedX / rect.width : 0
  const rawIndex = Math.round(ratio * (points - 1))
  const index = Math.max(0, Math.min(points - 1, rawIndex))
  const x = (index / Math.max(1, points - 1)) * width

  return {
    index,
    x
  }
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

export function VpnPage({ credentials, authState }) {
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

