# PanSou2CF

> 本项目来源于 [fish2018/pansou](https://github.com/fish2018/pansou)，一款高性能网盘资源搜索API服务。  
> 原项目基于 Go + Docker，本项目将其完整移植到 Cloudflare Workers，保持接口兼容。

89 个搜索插件 | 127 个 TG 频道 | 9 种网盘链路检测 | 4 个账号管理 | Vue 3 前端 | JWT 认证 | 渐进式分轮搜索

## 快速部署

1. Fork 本仓库
2. 创建 KV 命名空间 `PLUGIN_KV`（Cloudflare Dashboard → Workers & Pages → KV）
3. GitHub → Settings → Secrets → Actions 添加 Secrets：

| Secret | 必填 | 说明 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✓ | Edit Cloudflare Workers 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | ✓ | 账户 ID |
| `PLUGIN_KV_ID` | ✓ | KV namespace ID |
| `ADMIN_PASSWORD` | ✓ | 登录密码 |

4. Actions → Deploy to Cloudflare → Run workflow

部署后打开 `*.workers.dev`，用户名 `admin`，密码为设置的 `ADMIN_PASSWORD`。

## API

### 搜索 `GET/POST /api/search`

| 参数 | 说明 | 默认 |
|---|---|---|
| `kw` | 搜索关键词（必填） | - |
| `src` | `all` / `tg` / `plugin` | `all` |
| `plugins` | 逗号分隔 | 全部 89 个 |
| `channels` | TG 频道 | 127 个 |
| `conc` | 每轮插件数，0=全部 | 5 |
| `refresh` | 绕过缓存 | false |
| `res` | `merged_by_type` / `results` / `merge` | `merged_by_type` |
| `cloud_types` | 网盘过滤 `quark,baidu,aliyun,xunlei,uc,123` | 全部 |

```json
{
  "code": 0, "message": "success",
  "data": {
    "total": 42,
    "merged_by_type": {
      "quark": [{"url": "https://pan.quark.cn/s/abc?pwd=1234", "password": "1234", "note": "资源标题", "datetime": "2025-01-15T10:30:00Z", "source": "plugin:pansearch"}]
    },
    "results": [{"message_id": "ps_0", "title": "资源标题", "links": [{"type": "quark", "url": "...", "password": "1234"}]}]
  }
}
```

### 链接检测 `POST /api/check/links`

自动识别 9 种网盘类型，返回 `ok` / `bad` / `locked` / `uncertain` / `unsupported`。

```json
{ "links": ["https://pan.quark.cn/s/abc", "https://pan.baidu.com/s/1x?pwd=1234"] }
```

### 认证 `POST /api/auth/*`

```
POST /api/auth/login   { "username": "admin", "password": "..." }
→ { "token": "eyJ...", "expires_at": 1716000000, "username": "admin" }

POST /api/auth/verify  { "token": "..." }
→ { "valid": true, "username": "admin" }

POST /api/auth/logout
GET  /api/health        (无需认证)
```

### 账号管理

4 个高级搜索源通过 KV 持久化会话，每个提供 `get_status` / `login` / `logout` / `test_search`。

| 插件 | 路由 | 登录方式 | 搜索源 |
|---|---|---|---|
| Panlian | `/panlian/:hash` | 用户名+密码 | pinglian.lol |
| QQPD | `/qqpd/:hash` | QQ 扫码 | pd.qq.com 频道 |
| Gying | `/gying/:hash` | 用户名+密码 | gying.net |
| Weibo | `/weibo/:hash` | 微博扫码 | weibo.com |

## 渐进式分轮搜索

全部 89 个插件 + 127 个频道默认启用，分 4 轮渐进搜索避免超时：

| 轮次 | 插件数 | 间隔 | 用户感知 |
|---|---|---|---|
| 1 | 5 | 立即 | 3s 内出结果 |
| 2 | 15 | +2s | 结果变多 |
| 3 | 30 | +3s | 更加丰富 |
| 4 | 全部 | +3s | 完整结果 |

## 搜索算法

- **链接-标题关联**：从消息正文逐条提取每个链接的具体标题
- **智能合并**：同键按完整度评分（UniqueID、链接数、内容、频道）
- **三维排序**：时间分 + 关键词优先分 + 插件等级分
- **密码提取**：正则（提取码/密码/pwd/访问码）+ URL 参数（?pwd=）
- **链接集成**：百度/夸克自动附加 `?pwd=`，阿里附加 `?password=`

## 环境变量

在 Cloudflare Dashboard → Workers → pansou2cf → Settings → Variables 修改。

| 变量 | 默认 | 说明 |
|---|---|---|
| `AUTH_ENABLED` | `true` | 开启认证 |
| `AUTH_USERS` | `admin:$ADMIN_PASSWORD` | 用户列表 |
| `CHANNELS` | 127 个 | TG 频道 |
| `ENABLED_PLUGINS` | 空=全部 | 插件列表 |
| `PLUGIN_TIMEOUT` | `8` | 单插件超时秒数 |

## 项目结构

```
src/
  index.ts              # Hono 入口 + CORS + Auth
  config.ts             # 环境变量
  routes/
    search.ts           # /api/search
    auth.ts             # /api/auth/* (JWT HS256)
    check.ts            # /api/check/links
    plugin-panlian.ts   # /panlian/:hash
    plugin-qqpd.ts      # /qqpd/:hash
    plugin-gying.ts     # /gying/:hash
    plugin-weibo.ts     # /weibo/:hash
  service/
    search.ts           # 搜索编排：并行、缓存、去重、排序
    check.ts            # 9 种网盘验证
    kv-session.ts       # KV 会话 + AES-GCM
  plugin/
    registry.ts         # 插件注册表
    configs.ts          # 89 个插件 URL
    config-engine.ts    # JSON + 4层HTML 通用引擎
    pansearch.ts        # pansearch.me
    yunso.ts            # yunso.net
    alupan.ts           # alupan.net
pansou-web/             # Vue 3 前端
```

## 本地开发

```bash
npm install && npm run dev           # Worker → :8787
cd pansou-web && npm install && npm run dev  # Vue → :3000
AUTH_ENABLED=false npx wrangler dev  # 本地关闭认证
```

---

本项目来源于 [fish2018/pansou](https://github.com/fish2018/pansou)  
原项目作者：[fish2018](https://github.com/fish2018)  
License 与原项目一致
