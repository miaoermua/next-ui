import { fetchMaybeJson, performRequest, resolveApiUrl, getUbusSessionToken } from './transport'
import { fetchRealtimeBandwidth, fetchRealtimeConnections, fetchTopProcesses } from './metrics'
import { loginRouter } from './auth'

export async function diagnoseRouterConnection(options = {}) {
  const username = String(options.username || '').trim()
  const password = String(options.password || '').trim()
  const checks = []

  const pushCheck = (name, ok, message) => {
    checks.push({
      name,
      ok,
      message
    })
  }

  try {
    const ubusLogin = await performRequest('/ubus', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify({
        jsonrpc: '2.0',
        id: Date.now(),
        method: 'call',
        params: [getUbusSessionToken(), 'session', 'login', { username: 'root', password: '__invalid__' }]
      })
    })

    if (!ubusLogin.response.ok) {
      pushCheck('ubus 接口可达性', false, `HTTP ${ubusLogin.response.status}`)
    } else if (ubusLogin.body?.error) {
      pushCheck('ubus 接口可达性', false, `RPC error ${ubusLogin.body.error.code}`)
    } else {
      pushCheck('ubus 接口可达性', true, '可访问（返回正常）')
    }
  } catch (error) {
    pushCheck('ubus 接口可达性', false, error?.message || '请求失败')
  }

  try {
    const luci = await fetchMaybeJson(resolveApiUrl('/cgi-bin/luci'))
    if (!luci) {
      pushCheck('LuCI 页面可达性', false, '返回为空')
    } else {
      pushCheck('LuCI 页面可达性', true, '页面可访问')
    }
  } catch (error) {
    pushCheck('LuCI 页面可达性', false, error?.message || '请求失败')
  }

  if (username && password) {
    try {
      const loginState = await loginRouter(username, password)
      if (loginState.luciAuthenticated) {
        pushCheck(
          'LuCI 登录状态',
          true,
          `已登录${loginState.warning ? `（${loginState.warning}）` : ''}`
        )
      } else {
        pushCheck(
          'LuCI 登录状态',
          false,
          loginState.warning || '已登录 ubus，但 LuCI 会话未建立'
        )
      }
    } catch (error) {
      pushCheck('LuCI 登录状态', false, error?.message || '登录失败')
    }
  } else {
    pushCheck('LuCI 登录状态', false, '未提供用户名/密码，未执行登录测试')
  }

  try {
    await fetchRealtimeConnections()
    pushCheck('Realtime 连接数', true, '可读取')
  } catch (error) {
    pushCheck('Realtime 连接数', false, error?.message || '读取失败')
  }

  try {
    await fetchRealtimeBandwidth()
    pushCheck('Realtime 流量', true, '可读取')
  } catch (error) {
    pushCheck('Realtime 流量', false, error?.message || '读取失败')
  }

  try {
    await fetchTopProcesses(3)
    pushCheck('Processes 页面', true, '可读取')
  } catch (error) {
    pushCheck('Processes 页面', false, error?.message || '读取失败')
  }

  return {
    checks,
    passed: checks.filter((item) => item.ok).length,
    total: checks.length,
    sampledAt: Date.now()
  }
}

