# PanSou2CF

> 本项目来源于 [fish2018/pansou](https://github.com/fish2018/pansou)，一款高性能网盘资源搜索API服务。  
> 原项目基于 Go + Docker，本项目将其完整移植到 Cloudflare Workers，保持接口兼容。

89 个搜索插件 | 127 个 TG 频道 | 13 种网盘+磁力+电驴 | 4 个账号管理 | Vue 3 前端 | JWT 认证 | 渐进式分轮搜索

## 快速部署

1. Fork 本仓库
2. 创建 Cloudflare KV 命名空间 `PLUGIN_KV`：
   ```bash
   npx wrangler kv:namespace create PLUGIN_KV
   ```
3. GitHub → Settings → Secrets and variables → Actions → Secrets 添加：

| Secret | 必填 | 说明 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✓ | Edit Cloudflare Workers 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | ✓ | 账户 ID |
| `PLUGIN_KV_ID` | ✓ | KV namespace ID |
| `ADMIN_PASSWORD` | ✓ | 登录密码 |

4. Actions → Deploy to Cloudflare → Run workflow

部署后打开 `*.workers.dev`，用户名 `admin`，密码为 `ADMIN_PASSWORD`。

## API

### 搜索 `GET/POST /api/search`

| 参数 | 说明 | 默认 |
|---|---|---|
| `kw` | 搜索关键词（必填） | - |
| `src` | `all` / `tg` / `plugin` | `all` |
| `plugins` | 指定插件，逗号分隔 | 全部 89 个 |
| `channels` | TG 频道，逗号分隔 | 全部 127 个 |
| `conc` | 每轮插件数，0=全部 | 15 |
| `refresh` | 绕过缓存 | false |
| `res` | `merged_by_type` / `results` / `merge` | `merged_by_type` |
| `cloud_types` | 网盘过滤：`quark,baidu,aliyun,xunlei,uc,123,magnet,ed2k` | 全部 |

```json
{
  "code": 0, "message": "success",
  "data": {
    "total": 42,
    "merged_by_type": {
      "quark": [{"url": "https://pan.quark.cn/s/abc?pwd=1234", "password": "1234", "note": "资源标题", "datetime": "2025-01-15T10:30:00Z", "source": "plugin:pansearch"}],
      "magnet": [{"url": "magnet:?xt=urn:btih:...", "password": "", "note": "资源标题", "datetime": "...", "source": "tg:channel"}]
    },
    "results": [{"message_id": "ps_0", "title": "资源标题", "links": [{"type": "quark", "url": "...", "password": "1234"}]}]
  }
}
```

### 链接检测 `POST /api/check/links`

支持 9 种网盘 API 级验证，自动识别类型。返回 `ok` / `bad` / `locked` / `uncertain` / `unsupported`。

```json
{ "links": ["https://pan.quark.cn/s/abc", "https://pan.baidu.com/s/1x?pwd=1234"] }
```

| 网盘 | 标识 | 验证方式 |
|---|---|---|
| 夸克 Quark | `quark` | Token → Detail API |
| 百度 Baidu | `baidu` | 密码验证 → 列表 API |
| 阿里 Aliyun | `aliyun` | Share API |
| UC | `uc` | 页面检测 |
| 123 | `123` | Info API |
| 迅雷 Xunlei | `xunlei` | Share API |
| 115 | `115` | Snap API |
| 天翼 Tianyi | `tianyi` | XML API |

### 支持的链接类型

| 类型 | 格式 | 说明 |
|---|---|---|
| quark | `pan.quark.cn/s/...` | 夸克网盘 |
| baidu | `pan.baidu.com/s/...` | 百度网盘 |
| aliyun | `aliyundrive.com/s/...` | 阿里云盘 |
| xunlei | `pan.xunlei.com/s/...` | 迅雷网盘 |
| uc | `drive.uc.cn/s/...` | UC 网盘 |
| 123 | `123pan.com/s/...` | 123 云盘 |
| 115 | `115.com/s/...` | 115 网盘 |
| tianyi | `cloud.189.cn/t/...` | 天翼云盘 |
| mobile | `caiyun.139.com/...` | 移动云盘 |
| pikpak | `mypikpak.com/s/...` | PikPak |
| magnet | `magnet:?xt=urn:btih:...` | 磁力链接 |
| ed2k | `ed2k://\|file\|...` | 电驴链接 |

### 认证 `POST /api/auth/*`

```
POST /api/auth/login   { "username": "admin", "password": "..." }
→ { "token": "eyJ...", "expires_at": 1716000000, "username": "admin" }

POST /api/auth/verify  { "token": "..." }
→ { "valid": true, "username": "admin" }

POST /api/auth/logout
GET  /api/health        (无需认证)
```

### 账号管理插件

4 个高级搜索源通过 KV 持久化会话，与 Go 版接口兼容。

| 插件 | 路由 | 登录方式 | 搜索源 |
|---|---|---|---|
| Panlian | `/panlian/:hash` | 用户名+密码 | pinglian.lol |
| QQPD | `/qqpd/:hash` | QQ 扫码 | pd.qq.com 频道 |
| Gying | `/gying/:hash` | 用户名+密码 | gying.net |
| Weibo | `/weibo/:hash` | 微博扫码 | weibo.com |

每个插件提供 `get_status` / `login` / `logout` / `test_search` action。

### 插件诊断

```
GET /api/debug/plugins  (需认证)
→ { "tested_count": 10, "total_plugins": 89, "reachable": 8, "results": [...] }
```

测试插件 URL 可达性和返回结果数。

## 搜索架构

### 渐进式分轮搜索

全部 89 个插件 + 127 个 TG 频道默认启用，分 4 轮渐进搜索：

| 轮次 | 插件数 | 并发度 | 间隔 | 说明 |
|---|---|---|---|---|
| 预热 | 全部 | 20 | 搜索前 | 后台异步触发，不展示，模仿 Go 版 AsyncSearch |
| 1 | 15 | 20 | 立即 | 3s 内出第一批结果 |
| 2 | 30 | 20 | +2s | 追加更多结果 |
| 3 | 60 | 20 | +3s | 大规模搜索 |
| 4 | 全部 | 20 | +3s | 完整结果 |

每轮缓存独立（key 含 conc），避免命中旧缓存。

### TG 频道搜索

双通道回退：先尝试 Telegram 公开页面 `t.me/s/{channel}?q={keyword}`，失败则回退 `{channel}.pages.dev`。

### 搜索算法

- **链接-标题关联**：从 TG 消息正文逐条提取每个链接的具体标题
- **智能合并**：同键按完整度评分（UniqueID +10、链接 +5、内容 +3、频道 +2）
- **三维排序**：时间分（0-500）+ 关键词优先分（0-490）+ 插件等级分（-200~1000）
- **质量过滤**：只有高质量结果进入 `results` 字段
- **密码提取**：正则（提取码/密码/pwd/访问码）+ URL 参数 + 链接内 `?pwd=`
- **链接集成**：百度/夸克/迅雷自动附加 `?pwd=`，阿里附加 `?password=`

## 环境变量

在 Cloudflare Dashboard → Workers → pansou2cf → Settings → Variables 修改。

| 变量 | 默认 | 说明 |
|---|---|---|
| `AUTH_ENABLED` | `true` | 开启认证 |
| `AUTH_USERS` | `admin:$ADMIN_PASSWORD` | 用户列表 `user:pass,...` |
| `CHANNELS` | 127 个 | TG 频道，逗号分隔 |
| `ENABLED_PLUGINS` | 空=全部 | 指定启用的插件 |
| `PLUGIN_TIMEOUT` | `8` | 单插件超时秒数 |

## 项目结构

```
src/
  index.ts              # Hono 入口 + CORS + Auth（JWT HS256 签名验证）
  config.ts             # 环境变量配置
  routes/
    search.ts           # GET/POST /api/search
    auth.ts             # /api/auth/*
    check.ts            # /api/check/links
    plugin-panlian.ts   # /panlian/:hash（pinglian.lol 登录）
    plugin-qqpd.ts      # /qqpd/:hash（QQ QR 扫码）
    plugin-gying.ts     # /gying/:hash（gying.net 登录）
    plugin-weibo.ts     # /weibo/:hash（微博 QR 扫码）
  service/
    search.ts           # 搜索编排：并行 TG+插件、缓存、去重、排序
    check.ts            # 9 种网盘 API 级验证
    kv-session.ts       # KV 会话 + AES-256-GCM 加密
  plugin/
    netdisk-patterns.ts # 统一网盘/磁力/电驴 URL 正则 + 密码提取
    registry.ts         # 插件注册表
    boot.ts             # 启动引导
    configs.ts          # 89 个插件 URL 配置（从 Go 源码提取）
    config-engine.ts    # 5 层通用解析：VOD→WP→Article→Selectors→Generic
    pansearch.ts        # pansearch.me 专用（API JSON 解析）
    yunso.ts            # yunso.net 专用（HTML 结构化）
    alupan.ts           # alupan.net 专用（Article 块）
pansou-web/             # Vue 3 前端（CI 构建 → Worker 静态资源）
.github/workflows/      # GitHub Actions CI/CD
```

## 本地开发

```bash
npm install && npm run dev            # Worker → :8787
cd pansou-web && npm install && npm run dev   # Vue → :3000
AUTH_ENABLED=false npx wrangler dev   # 本地关闭认证方便调试
```

---

本项目来源于 [fish2018/pansou](https://github.com/fish2018/pansou)  
原项目作者：[fish2018](https://github.com/fish2018)  
License 与原项目一致
