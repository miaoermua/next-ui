import { useEffect, useState } from 'preact/hooks'
import {
  diagnoseRouterConnection,
  getRouterAuthState,
  loginRouter,
  resetRouterAuth,
  setRouterAddress
} from '../api/router'

export function useRouterAuth(routerDefaults) {
  const shouldAutoLogin = routerDefaults?.autoLogin && Boolean(routerDefaults.password)

  const [authState, setAuthState] = useState(getRouterAuthState())
  const [credentials, setCredentials] = useState({
    address: routerDefaults?.address || authState.address,
    password: routerDefaults?.password || ''
  })
  const [authLoading, setAuthLoading] = useState(false)
  const [authMessage, setAuthMessage] = useState(
    shouldAutoLogin ? '检测到本地环境凭据，准备自动登录...' : '未登录，请在右上角设置中连接路由器'
  )
  const [successToast, setSuccessToast] = useState('')
  const [diagnostics, setDiagnostics] = useState(null)
  const [diagnosticsLoading, setDiagnosticsLoading] = useState(false)
  const [autoLoginTried, setAutoLoginTried] = useState(!shouldAutoLogin)

  useEffect(() => {
    if (!successToast) {
      return undefined
    }

    const timer = window.setTimeout(() => {
      setSuccessToast('')
    }, 2200)

    return () => {
      window.clearTimeout(timer)
    }
  }, [successToast])

  useEffect(() => {
    if (autoLoginTried) {
      return undefined
    }

    let cancelled = false

    const runAutoLogin = async () => {
      setAuthLoading(true)
      setAuthMessage('正在使用本地环境变量自动登录...')

      try {
        const nextAuthState = setRouterAddress(credentials.address)
        if (cancelled) {
          return
        }

        setAuthState(nextAuthState)
        const state = await loginRouter('root', credentials.password)
        if (cancelled) {
          return
        }

        setAuthState(state)
        const suffix = state.warning ? `（注意：${state.warning}）` : ''
        setAuthMessage(`自动登录成功，已连接 ${state.address}${suffix}`)
        setSuccessToast(`自动连接成功：${state.address}`)
      } catch (error) {
        if (cancelled) {
          return
        }

        setAuthMessage(error?.message || '本地环境变量自动登录失败，请手动连接')
      } finally {
        if (!cancelled) {
          setAuthLoading(false)
          setAutoLoginTried(true)
        }
      }
    }

    runAutoLogin()

    return () => {
      cancelled = true
    }
  }, [autoLoginTried, credentials.address, credentials.password])

  const handleAuthInput = (field) => (event) => {
    const value = event?.target?.value ?? ''
    setCredentials((previous) => ({
      ...previous,
      [field]: value
    }))
  }

  const handleLogin = async (event) => {
    if (event?.preventDefault) {
      event.preventDefault()
    }

    setAuthLoading(true)
    setAuthMessage('正在登录路由器...')

    try {
      const nextAuthState = setRouterAddress(credentials.address)
      setAuthState(nextAuthState)

      const state = await loginRouter('root', credentials.password)
      setAuthState(state)
      const suffix = state.warning ? `（注意：${state.warning}）` : ''
      setAuthMessage(`登录成功，已连接 ${state.address}${suffix}`)
      setSuccessToast(`连接成功：${state.address}`)
    } catch (error) {
      setAuthMessage(error?.message || '登录失败，请检查密码、代理或路由器登录状态')
      setDiagnostics(null)
    } finally {
      setAuthLoading(false)
    }
  }

  const handleLogout = () => {
    resetRouterAuth()
    const state = getRouterAuthState()
    setAuthState(state)
    setDiagnostics(null)
    setAuthMessage(`已断开 ${state.address}，当前显示占位数据`)
  }

  const runDiagnostics = async () => {
    setDiagnosticsLoading(true)
    setDiagnostics(null)

    try {
      const nextAuthState = setRouterAddress(credentials.address)
      setAuthState(nextAuthState)

      const result = await diagnoseRouterConnection({
        username: 'root',
        password: credentials.password
      })
      setDiagnostics(result)
      setAuthMessage(`诊断完成：通过 ${result.passed}/${result.total}`)
    } catch (error) {
      setDiagnostics({
        checks: [],
        passed: 0,
        total: 0,
        sampledAt: Date.now(),
        error: error?.message || '诊断失败'
      })
      setAuthMessage(error?.message || '诊断失败，请检查地址、密码或网络连接')
    } finally {
      setDiagnosticsLoading(false)
    }
  }

  return {
    authState,
    credentials,
    authLoading,
    authMessage,
    successToast,
    setSuccessToast,
    diagnostics,
    diagnosticsLoading,
    autoLoginTried,
    setCredentials,
    setAuthMessage,
    handleAuthInput,
    handleLogin,
    handleLogout,
    runDiagnostics
  }
}

