import { useEffect, useMemo, useState } from 'preact/hooks'
import { fetchInstalledPackages } from '../api/router'
import { Skeleton, SkeletonTextBlock } from '../components/Skeleton'

function clamp(value, min, max) {
  return Math.min(max, Math.max(min, value))
}
export function InstalledPackagesPage() {
  const [packages, setPackages] = useState([])
  const [query, setQuery] = useState('')
  const [loading, setLoading] = useState(false)
  const [loadedOnce, setLoadedOnce] = useState(false)
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
      setLoadedOnce(true)
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
        {loadedOnce ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">来源：/cgi-bin/luci/admin/system/packages?display=installed</p>
        ) : (
          <div className="mt-2 max-w-sm">
            <SkeletonTextBlock lines={1} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 sm:grid-cols-3">
        {loadedOnce ? (
          <>
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
          </>
        ) : (
          Array.from({ length: 3 }, (_, index) => (
            <div className="rounded-xl border border-zinc-200 bg-white p-4 dark:border-zinc-700 dark:bg-zinc-900" key={`meta-skeleton-${index}`}>
              <Skeleton className="h-3 w-24" />
              <Skeleton className="mt-2 h-6 w-20" />
              <Skeleton className="mt-3 h-2 w-full" />
              <Skeleton className="mt-2 h-3 w-16" />
            </div>
          ))
        )}
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
            {!loadedOnce && loading ? (
              Array.from({ length: 12 }, (_, rowIndex) => (
                <tr key={`pkg-skeleton-${rowIndex}`}>
                  <td className="px-4 py-2.5">
                    <Skeleton className="h-4 w-full" />
                  </td>
                  <td className="px-4 py-2.5">
                    <Skeleton className="h-4 w-32" />
                  </td>
                </tr>
              ))
            ) : filteredItems.length ? (
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

