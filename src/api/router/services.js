import { fetchMaybeJson } from './transport'
import { resolveLuciPath } from './auth'

const STARTUP_PATH = '/admin/system/startup'
const PACKAGES_PATH = '/admin/system/packages?display=installed'
const NETWORK_LAN_PATH = '/admin/network/network/lan'
const NETWORK_WAN_PATH = '/admin/network/network/wan'
const NETWORK_DHCP_PATH = '/admin/network/dhcp'
const OPENCLASH_TOOLBAR_PATH = '/admin/services/openclash/toolbar_show'
const ADGUARD_HOME_PATH = '/admin/services/AdGuardHome'
const ADGUARD_HOME_STATUS_PATH = '/admin/services/AdGuardHome/status'
const DDNS_GO_PATH = '/admin/services/ddns-go'
const DDNS_GO_STATUS_PATH = '/admin/services/ddnsgo_status'
const APPFILTER_OAF_STATUS_PATH = '/admin/network/get_oaf_status'
const APPFILTER_BASE_PATH = '/admin/network/get_app_filter_base'

export async function fetchStartupEntries(limit = 30) {
  const payload = await fetchMaybeJson(resolveLuciPath(STARTUP_PATH))
  return normalizeStartupEntries(payload, limit)
}

export async function fetchInstalledPackages(limit = 2000) {
  const payload = await fetchMaybeJson(resolveLuciPath(PACKAGES_PATH))
  return normalizeInstalledPackages(payload, limit)
}

export async function fetchPackagesStorageMeta() {
  const payload = await fetchMaybeJson(resolveLuciPath(PACKAGES_PATH))
  return normalizePackagesStorageMeta(payload)
}

export async function fetchNetworkLanConfig() {
  const payload = await fetchMaybeJson(resolveLuciPath(NETWORK_LAN_PATH))
  return payload
}

export async function fetchNetworkWanConfig() {
  const payload = await fetchMaybeJson(resolveLuciPath(NETWORK_WAN_PATH))
  return payload
}

export async function fetchDhcpLanIpv6Config() {
  const payload = await fetchMaybeJson(resolveLuciPath(NETWORK_DHCP_PATH))
  return payload
}

export async function fetchOpenClashToolbarStatus() {
  const payload = await fetchMaybeJson(resolveLuciPath(OPENCLASH_TOOLBAR_PATH))
  return payload
}

export async function fetchAdGuardHomeConfig() {
  const payload = await fetchMaybeJson(resolveLuciPath(ADGUARD_HOME_PATH))
  return payload
}

export async function fetchAdGuardHomeStatus() {
  const payload = await fetchMaybeJson(resolveLuciPath(ADGUARD_HOME_STATUS_PATH))
  return payload
}

export async function fetchDdnsGoConfig() {
  const payload = await fetchMaybeJson(resolveLuciPath(DDNS_GO_PATH))
  return payload
}

export async function fetchDdnsGoStatus() {
  const payload = await fetchMaybeJson(resolveLuciPath(DDNS_GO_STATUS_PATH))
  return payload
}

export async function fetchAppFilterStatus() {
  const payload = await fetchMaybeJson(resolveLuciPath(APPFILTER_OAF_STATUS_PATH))
  return payload
}

export async function fetchPublicNetworkAddresses() {
  const payload = await fetchMaybeJson(resolveLuciPath(APPFILTER_BASE_PATH))
  return payload
}

function normalizeStartupEntries(payload, limit) {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  const items = Array.isArray(payload.entries) ? payload.entries : []
  return items.slice(0, limit)
}

function normalizeInstalledPackages(payload, limit) {
  if (!payload || typeof payload !== 'object') {
    return []
  }

  const items = Array.isArray(payload.packages) ? payload.packages : []
  return items.slice(0, limit)
}

function normalizePackagesStorageMeta(payload) {
  if (!payload || typeof payload !== 'object') {
    return null
  }

  return payload.storage || null
}

