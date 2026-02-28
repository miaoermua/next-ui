import { useEffect, useState } from 'preact/hooks'
import { fetchStartupEntries, fetchTopProcesses, setRouterAddress } from '../api/router'

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
                  <td className="px-3 py-2">{item.enabled ? '启用' : '禁用'}</td>
                  <td className="px-3 py-2">{item.script || '-'}</td>
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

export function ServicesPage({ credentials }) {
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
        <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">系统进程 top 与系统服务：启动项 init.d</p>
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
