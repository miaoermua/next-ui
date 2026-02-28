import { useEffect, useState } from 'preact/hooks'
import {
  fetchDhcpLanIpv6Config,
  fetchInterfaceStatusByName,
  fetchNetworkLanConfig,
  fetchNetworkWanConfig
} from '../api/router'
import { Skeleton, SkeletonTextBlock } from '../components/Skeleton'


function ConfigCardSkeleton({ lines = 8 }) {
  return (
    <section className="space-y-3 rounded-xl border border-zinc-200 bg-white p-5 dark:border-zinc-700 dark:bg-zinc-900" aria-hidden="true">
      <Skeleton className="h-4 w-36" />
      <div className="space-y-2">
        {Array.from({ length: lines }, (_, index) => (
          <Skeleton className="h-3.5 w-full" key={index} />
        ))}
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

export function NetworkSettingsPage() {
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
  const [loadedOnce, setLoadedOnce] = useState(false)
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
      setLoadedOnce(true)
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
        {loadedOnce ? (
          <p className="mt-1 text-sm text-zinc-500 dark:text-zinc-400">来自 LuCI 网络接口页（LAN/WAN）</p>
        ) : (
          <div className="mt-2 max-w-sm">
            <SkeletonTextBlock lines={1} />
          </div>
        )}
      </div>

      <div className="grid grid-cols-1 gap-4 xl:grid-cols-2">
        {!loadedOnce && loading ? (
          <>
            <ConfigCardSkeleton lines={10} />
            <ConfigCardSkeleton lines={8} />
            <ConfigCardSkeleton lines={9} />
          </>
        ) : (
          <>
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
          </>
        )}
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

