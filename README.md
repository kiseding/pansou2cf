# PanSou2CF

PanSou 网盘资源搜索的 Cloudflare Workers 移植版。89 个搜索插件、9 种网盘链路检测、4 个账号管理插件、Vue 3 前端、JWT 认证。

## 快速部署

1. Fork 本仓库
2. 创建 Cloudflare KV 命名空间：
   ```bash
   npx wrangler kv:namespace create PLUGIN_KV
   ```
3. 在 GitHub → Settings → Secrets and variables → Actions → Secrets 添加：

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | Edit Cloudflare Workers 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | 账户 ID |
| `PLUGIN_KV_ID` | KV namespace ID |
| `ADMIN_PASSWORD` | 登录密码 |
| `AUTH_JWT_SECRET` | JWT 密钥（可选，不设使用默认值） |

4. Actions → Deploy to Cloudflare → Run workflow

部署后打开 `*.workers.dev`，输入用户名 `admin` 和设置的密码登录。

## API

### 搜索

```
GET /api/search?kw=关键词
POST /api/search  { "kw": "关键词" }
```

| 参数 | 说明 | 默认 |
|---|---|---|
| `kw` | 搜索关键词（必填） | - |
| `src` | `all` / `tg` / `plugin` | `all` |
| `plugins` | 指定插件，逗号分隔 | 22 个精选 |
| `channels` | TG 频道 | `tgsearchers6` |
| `conc` | 并发数 | 10 |
| `refresh` | 绕过缓存 | false |
| `res` | `merged_by_type` / `results` | `merged_by_type` |
| `cloud_types` | 网盘过滤 | 全部 |

```json
{
  "code": 0,
  "data": {
    "total": 42,
    "merged_by_type": {
      "quark": [{"url": "...", "password": "1234", "note": "资源标题", "datetime": "...", "source": "plugin:pansearch"}]
    }
  }
}
```

### 链接检测

```
POST /api/check/links
{ "links": ["https://pan.quark.cn/s/abc"] }
```

自动识别网盘类型，返回 `ok` / `bad` / `locked` / `uncertain` / `unsupported`。

支持 9 种网盘：夸克、百度、阿里、UC、123、迅雷、115、天翼、移动。

### 认证

```
POST /api/auth/login   { "username": "admin", "password": "..." }  →  { "token": "...", "expires_at": ..., "username": "admin" }
POST /api/auth/verify  { "token": "..." }                          →  { "valid": true, "username": "admin" }
POST /api/auth/logout
```

### 账号管理

4 个插件通过 KV 持久化会话，与 Go 版接口兼容：

| 插件 | 路由 | 登录方式 | 搜索源 |
|---|---|---|---|
| Panlian | `/panlian/:hash` | 用户名+密码 | pinglian.lol |
| QQPD | `/qqpd/:hash` | QQ 扫码 | pd.qq.com |
| Gying | `/gying/:hash` | 用户名+密码 | gying.net |
| Weibo | `/weibo/:hash` | 微博扫码 | weibo.com |

每个提供 `get_status` / `login` / `logout` / `test_search` action。

### 健康检查

```
GET /api/health     (无需认证)
```

## 环境变量

| 变量 | 默认值 | 说明 |
|---|---|---|
| `AUTH_ENABLED` | `true` | 是否开启认证 |
| `AUTH_USERS` | `admin:$ADMIN_PASSWORD` | 用户列表 `user:pass,...` |
| `CHANNELS` | `tgsearchers6` | TG 频道 |
| `ENABLED_PLUGINS` | 22 个精选 | 空=全部 89 个，不推荐 |
| `PLUGIN_TIMEOUT` | `8` | 单插件超时秒数 |

在 Cloudflare Dashboard → Workers & Pages → pansou2cf → Settings → Variables 中修改。

## 项目结构

```
src/
  index.ts                  # Hono 入口 + CORS + Auth 中间件
  config.ts                 # 环境变量
  types.ts                  # 类型
  routes/
    search.ts               # /api/search
    auth.ts                 # /api/auth/* (JWT HS256)
    check.ts                # /api/check/links
    plugin-panlian.ts       # /panlian/:hash
    plugin-qqpd.ts          # /qqpd/:hash
    plugin-gying.ts         # /gying/:hash
    plugin-weibo.ts         # /weibo/:hash
  service/
    search.ts               # 搜索编排：并行、缓存、去重、排序、链接-标题关联
    check.ts                # 9 种网盘 API 验证
    kv-session.ts           # KV 会话 + AES-256-GCM 加密
  plugin/
    registry.ts             # 插件注册表
    configs.ts              # 89 个插件 URL（Go 源码提取）
    config-engine.ts        # JSON + 4层 HTML 通用解析
    pansearch.ts            # pansearch.me 专用（API JSON 解析）
    yunso.ts                # yunso.net 专用（HTML 解析）
    alupan.ts               # alupan.net 专用（HTML 解析）
pansou-web/                 # Vue 3 前端（CI 构建 → Worker 静态资源）
```

## 本地开发

```bash
npm install && npm run dev    # Worker → :8787
cd pansou-web && npm install && npm run dev  # Vue → :3000
```

本地需要设置环境变量（或修改 wrangler.toml）：
```bash
AUTH_ENABLED=false npx wrangler dev    # 本地关闭认证方便调试
```
