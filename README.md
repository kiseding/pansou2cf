# PanSou2CF

PanSou 网盘资源搜索的 Cloudflare Workers 移植版。将原 Go 项目完整迁移到 TypeScript，包括 89 个搜索插件、9 种网盘链路检测、4 个账号管理插件和 Vue 3 前端，可直接部署在 Cloudflare Workers 免费额度内运行。

## 快速开始

1. Fork 本仓库
2. 创建 Cloudflare KV 命名空间 `PLUGIN_KV`，记下 ID
3. 在 GitHub Secrets 设置 `CLOUDFLARE_API_TOKEN`、`CLOUDFLARE_ACCOUNT_ID`、`PLUGIN_KV_ID`、`ADMIN_PASSWORD`
4. Actions → Deploy to Cloudflare → Run workflow

## API

### 搜索 `GET/POST /api/search`

| 参数 | 说明 | 默认值 |
|---|---|---|
| `kw` | 搜索关键词（必填） | - |
| `src` | `all` / `tg` / `plugin` | `all` |
| `plugins` | 指定插件，逗号分隔 | 默认 22 个精选 |
| `channels` | TG 频道，逗号分隔 | `tgsearchers6` |
| `conc` | 并发数，最大 20 | 10 |
| `refresh` | 绕过缓存 | false |
| `res` | `merged_by_type` / `results` | `merged_by_type` |
| `cloud_types` | 网盘过滤 `quark,baidu,alipan,xunlei,uc,123` | 全部 |
| `filter` | `{"include":["4K"],"exclude":["短剧"]}` | - |

```json
{
  "code": 0, "message": "success",
  "data": {
    "total": 42,
    "merged_by_type": {
      "quark": [{"url": "...", "password": "1234", "note": "资源标题", "datetime": "2025-01-15T10:30:00Z", "source": "plugin:pansearch"}]
    },
    "results": [{"message_id": "ps_0", "title": "...", "links": [{"type": "quark", "url": "...", "password": "1234"}]}]
  }
}
```

### 链接检测 `POST /api/check/links`

支持 9 种网盘 API 级验证，自动识别或手动指定类型。

| 网盘 | 标识 | 验证方式 |
|---|---|---|
| 夸克 | `quark` | Token API → Detail API |
| 百度 | `baidu` | 密码验证 → 列表 API |
| 阿里 | `aliyun` | Share API |
| UC | `uc` | 页面检测 |
| 123 | `123` | Info API |
| 迅雷 | `xunlei` | Share API |
| 115 | `115` | Snap API |
| 天翼 | `tianyi` | XML API |

响应 state：`ok`（24h）/ `bad`（6h）/ `locked`（12h）/ `uncertain`（30m）

### 认证

```
POST /api/auth/login   { "username": "admin", "password": "admin" }
POST /api/auth/verify  { "token": "..." }
POST /api/auth/logout
```

### 账号管理插件

4 个插件通过 KV 持久化会话，每个提供 `get_status` / `login` / `logout` / `test_search` action。

| 插件 | 路由 | 登录方式 | 搜索源 |
|---|---|---|---|
| Panlian | `/panlian/:hash` | 用户名+密码 | pinglian.lol |
| QQPD | `/qqpd/:hash` | QQ 扫码 | pd.qq.com 频道 |
| Gying | `/gying/:hash` | 用户名+密码 | gying.net |
| Weibo | `/weibo/:hash` | 微博扫码 | weibo.com 用户博客 |

### 健康检查

```
GET /api/health
```

## 部署

### GitHub Secrets

| Secret | 必填 | 说明 |
|---|---|---|
| `CLOUDFLARE_API_TOKEN` | ✓ | Edit Cloudflare Workers 权限 |
| `CLOUDFLARE_ACCOUNT_ID` | ✓ | Cloudflare 账户 ID |
| `PLUGIN_KV_ID` | ✓ | KV namespace ID |
| `ADMIN_PASSWORD` | ✓ | 管理员密码 |
| `AUTH_JWT_SECRET` | ✓ | JWT 签名密钥（随机字符串） |
| `PANLIAN_ENCRYPTION_KEY` 等 | | 插件加密密钥（可选，有默认值） |

创建 KV namespace：
```bash
npx wrangler kv:namespace create PLUGIN_KV
```

### 环境变量

| 变量 | 默认值 |
|---|---|
| `CHANNELS` | `tgsearchers6` |
| `ENABLED_PLUGINS` | 22 个精选（空字符串=全部 89 个，但不推荐） |
| `AUTH_ENABLED` | `true` |
| `AUTH_USERS` | `admin:$ADMIN_PASSWORD` |
| `PLUGIN_TIMEOUT` | `8` |

## 项目结构

```
src/
  index.ts              # Hono 入口
  config.ts             # 环境变量
  types.ts              # 类型
  routes/
    search.ts           # /api/search
    auth.ts             # /api/auth/*
    check.ts            # /api/check/links
    plugin-panlian.ts   # /panlian/:hash
    plugin-qqpd.ts      # /qqpd/:hash
    plugin-gying.ts     # /gying/:hash
    plugin-weibo.ts     # /weibo/:hash
  service/
    search.ts           # 搜索编排：并行、缓存、去重、排序
    check.ts            # 9 种网盘链接验证
    kv-session.ts       # KV 会话存储 + AES-GCM
  plugin/
    registry.ts         # 插件注册表
    configs.ts          # 89 个插件 URL 配置
    config-engine.ts    # 通用解析引擎（JSON + 4层HTML）
    pansearch.ts        # pansearch.me 专用
    yunso.ts            # yunso.net 专用
    alupan.ts           # alupan.net 专用
pansou-web/             # Vue 3 前端
```

## 搜索算法

- **链接-标题关联**：从 TG 消息正文逐条提取每个链接的具体标题
- **智能合并**：同键结果按完整度评分（UniqueID、链接数、内容长度、频道）选最优
- **三维排序**：时间分（0-500）+ 关键词优先分（0-490）+ 插件等级分（-200~1000）
- **质量过滤**：低质量结果进 `merged_by_type`，高质量进 `results`
- **密码提取**：正则（`提取码`/`密码`/`pwd`/`访问码`）+ URL 参数（`?pwd=`）

## 本地开发

```bash
npm install && npm run dev    # Worker → http://localhost:8787
cd pansou-web && npm install && npm run dev  # Vue → http://localhost:3000
```

## License

与原项目一致。
