# next-ui 

![vitejs](https://ziadoua.github.io/m3-Markdown-Badges/badges/ViteJS/vitejs1.svg)
![tailwindcss](https://ziadoua.github.io/m3-Markdown-Badges/badges/TailwindCSS/tailwindcss1.svg)

一个基于 `Preact + Vite + Tailwind CSS` 的 OpenWrt / LEDE Web 管理前端实验项目。

项目目标是提供更现代的管理面板，并通过开发代理直接对接路由器 LuCI/ubus 接口读取实时状态，本项目不提供其他任何服务。

目前所有功能都未完善，野路子实现，仅作为欣赏骨架使用，在公网访问，需要 HTTPS 访问 TLS/SSL 证书保证安全。

> 目前只支持 Lean's LEDE / QWRT / CatWrt

## 功能概览

- 仪表盘（系统概览）
  - CPU 负载、内存、连接数、WAN/WAN6 流量趋势
  - 主机型号、CPU 型号、OpenWrt 固件版本
  - DHCP 租约、进程 TOP、启动项
- 软件包页面
  - 已安装软件包列表（支持筛选、刷新）
- 网络设置页面（静态示例表单）
- 路由器连接管理
  - 地址配置、登录、断开、链路诊断

## 技术栈

- `Preact`
- `Vite`
- `Tailwind CSS`
- `lucide-react`（图标）

## 快速开始

### 1) 安装依赖

```bash
pnpm install
```

### 2) 启动开发服务器

```bash
pnpm run dev
```

默认启动后访问 Vite 提示地址（通常是 `http://localhost:5173`）。

### 2.1) 可选：本地 env 自动登录

可在 `.env.local` 中配置以下变量：

- `VITE_ROUTER_ADDRESS`：路由器地址（支持 `http://` / `https://`）
- `VITE_ROUTER_PASSWORD`：登录密码
- `VITE_ROUTER_AUTO_LOGIN`：是否自动登录（可选：`true/false`，默认有密码时自动开启）

示例：

```env
VITE_ROUTER_ADDRESS=http://10.0.0.1
VITE_ROUTER_PASSWORD=your_password
VITE_ROUTER_AUTO_LOGIN=true
```

### 3) 构建生产包

```bash
pnpm run build
```

### 4) 本地预览生产包

```bash
pnpm run preview
```

## 代理与请求机制

本项目没有独立常驻后端，开发环境通过 Vite 中间件代理路由器请求，生产（Vercel）通过 Serverless Function 代理。

- 前端统一请求前缀：`/router-api`
- 开发代理中间件：`vite.config.js`
- 生产代理入口：`api/router-api.js`（由 `vercel.json` 将 `/router-api/*` 重写到该函数）
- 路由器目标由请求头控制：
  - `x-router-host`（例如 `10.0.0.4`）
  - `x-router-scheme`（`http` 或 `https`）

代理会将 Cookie `Path` 重写到 `/router-api`，从而在浏览器侧保持会话。

## 主要数据来源（LuCI / ubus）

- `GET /cgi-bin/luci/admin/status/overview?status=1`
- `GET /cgi-bin/luci/admin/status/overview`（HTML 元信息解析）
- `GET /cgi-bin/luci/admin/network/iface_status/...`
- `GET /cgi-bin/luci/admin/status/processes`
- `GET /cgi-bin/luci/admin/system/startup`
- `GET /cgi-bin/luci/admin/system/packages?display=installed`
- `GET /cgi-bin/luci/admin/status/realtime/connections/`
- `GET /cgi-bin/luci/admin/status/realtime/bandwidth/`
- `POST /ubus`（登录与系统信息）

## 项目结构

```text
src/
  App.jsx           # 主界面、路由与各页面组件
  main.jsx          # 应用入口
  index.css         # Tailwind 入口
  api/
    router.js       # LuCI/ubus 请求、解析与状态汇总
vite.config.js      # 开发代理与 Preact 配置
```

## 注意事项

- 当前更适合内网环境使用，默认信任路由器端返回。
- 部分页面仍是占位（服务/插件/VPN/存储）。
- 不同固件主题（如 Argon/Design/CatWrt）HTML 结构可能有差异；解析逻辑已做回退，但仍可能受影响。

## 常见问题

### 1) 登录后数据还是空的

- 确认路由器地址正确（IP/端口/协议）。
- 确认 LuCI 与 ubus 均可访问。
- 在仪表盘使用“诊断”按钮查看每一步失败点。

### 2) CPU 型号显示不准确

项目会按以下顺序尽量识别：

1. `overview?status=1` 的 `cpuinfo`
2. `ubus system.board`
3. `/proc/cpuinfo`（ubus file 读取）
4. 缓存结果

如果固件裁剪较多、`file` 相关 ubus 能力被禁用，可能退化为较少信息。
