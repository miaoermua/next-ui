import { useEffect, useState } from 'preact/hooks'
import {
  fetchAdGuardHomeConfig,
  fetchAdGuardHomeStatus,
  fetchAppFilterStatus,
  fetchDdnsGoConfig,
  fetchDdnsGoStatus,
  setRouterAddress
} from '../api/router'

export function PluginsPage({ credentials, authState }) {
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
