import { useEffect, useMemo, useState } from 'preact/hooks'
import {
  Gauge,
  Wrench,
  Puzzle,
  Shield,
  HardDrive,
  Network,
  Terminal,
  Menu,
  Info,
  Settings,
  X
} from 'lucide-react'
import {
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
import { DashboardPage } from './pages/DashboardPage'
import { NetworkSettingsPage } from './pages/NetworkSettingsPage'

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

const ROUTER_DEFAULTS = getRouterDefaults()

const MODAL_TRANSITION_MS = 220

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
      return <DashboardPage authState={authState} credentials={credentials} />
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
