# PanSou2CF

PanSou 网盘资源搜索的 Cloudflare Workers 移植版。89 个搜索插件、9 种网盘链路检测、4 个账号管理插件、Vue 前端，完整复刻原 Go 版功能。

## 项目结构

```
src/
  index.ts                  # Hono 应用入口 + 中间件
  config.ts                 # 环境变量配置
  types.ts                  # 类型定义
  routes/
    search.ts               # GET/POST  /api/search
    auth.ts                 # POST      /api/auth/*
    check.ts                # POST      /api/check/links
    plugin-panlian.ts       # POST/GET  /panlian/:hash  账号管理
    plugin-qqpd.ts          # POST/GET  /qqpd/:hash     账号管理
    plugin-gying.ts         # POST/GET  /gying/:hash    账号管理
    plugin-weibo.ts         # POST/GET  /weibo/:hash    账号管理
  service/
    search.ts               # 搜索编排：并行、缓存、去重、排序、链接-标题关联
    check.ts                # 9 种网盘 API 级链接验证
    kv-session.ts           # KV 会话存储 + AES-256-GCM 加密
  plugin/
    registry.ts             # 插件注册表
    boot.ts                 # 启动引导
    configs.ts              # 89 个插件配置
    config-engine.ts        # 通用解析引擎（JSON + 4层HTML策略）
    pansearch.ts            # pansearch.me 专用
    yunso.ts                # yunso.net 专用
    alupan.ts               # alupan.net 专用
pansou-web/                 # Vue 3 前端（独立构建）
```

## API

### 搜索 `GET/POST /api/search`

| 参数 | 说明 | 默认值 |
|---|---|---|
| `kw` | 搜索关键词（必填） | - |
| `src` | 来源：`all` / `tg` / `plugin` | `all` |
| `plugins` | 指定插件，逗号分隔 | 全部 89 个 |
| `channels` | TG 频道，逗号分隔 | `tgsearchers6` |
| `conc` | 并发数 | 10, 最大 20 |
| `refresh` | 绕过缓存 | `false` |
| `res` | 返回格式：`merged_by_type` / `results` | `merged_by_type` |
| `cloud_types` | 网盘过滤：`quark,baidu,alipan,xunlei,uc,123` | 全部 |
| `filter` | 关键词过滤 `{"include":["4K"],"exclude":["短剧"]}` | - |

响应：

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 100,
    "merged_by_type": {
      "quark": [{ "url": "https://pan.quark.cn/s/abc", "password": "1234", "note": "资源标题", "datetime": "2025-01-15T10:30:00Z", "source": "plugin:pansearch" }],
      "baidu": [{ "url": "https://pan.baidu.com/s/1xyz", "password": "abcd", "note": "另一个资源", "datetime": "...", "source": "tg:tgsearchers6" }]
    },
    "results": [{ "message_id": "pansearch_0", "unique_id": "...", "title": "...", "links": [...] }]
  }
}
```

### 链接检测 `POST /api/check/links`

支持 9 种网盘 API 级验证，参数支持自动识别和手动指定两种格式：

```json
// 自动识别
{ "links": ["https://pan.quark.cn/s/abc", "https://pan.baidu.com/s/1x?pwd=1234"] }
// 手动指定
{ "items": [{ "diskType": "quark", "url": "https://pan.quark.cn/s/abc", "password": "1234" }] }
```

响应 `state`：`ok`（有效，TTL 24h）/ `bad`（失效，6h）/ `locked`（需提取码，12h）/ `uncertain`（不确定，30m）/ `unsupported`（不支持）

| 网盘 | 验证方式 |
|---|---|
| 夸克 Quark | Token API → Detail API |
| 百度 Baidu | 密码验证 → 列表 API |
| 阿里 Aliyun | Share API 匿名获取 |
| UC | 页面内容检测 |
| 123 | Share Info API |
| 迅雷 Xunlei | Share API |
| 115 | Snap API |
| 天翼 Tianyi | XML API |
| 移动 Mobile | 暂不支持（需 AES-CBC 加密） |

### 认证

```
POST /api/auth/login   { "username": "admin", "password": "admin" }
POST /api/auth/verify  { "token": "..." }
POST /api/auth/logout
```

### 账号管理插件

4 个插件的完整账号管理功能，通过 KV 持久化会话。

| 插件 | 路径 | 认证方式 | 搜索源 |
|---|---|---|---|
| Panlian | `/panlian/:hash` | 用户名+密码 | pinglian.lol |
| QQPD | `/qqpd/:hash` | QQ 二维码扫码 | pd.qq.com 频道 |
| Gying | `/gying/:hash` | 用户名+密码 | gying.net（可配镜像站） |
| Weibo | `/weibo/:hash` | 微博二维码扫码 | weibo.com 用户博客 |

每个插件提供 `get_status` / `login` / `logout` / `test_search` 等 action，通过 `POST /plugin/:hash` 调用，与 Go 版接口完全兼容。

### 健康检查

```
GET /api/health
→ { "status": "ok", "plugin_count": 89, "plugins": [...], "auth_enabled": false }
```

## 搜索算法

与 Go 版一致的三维排序 + 质量过滤：

- 链接-标题关联：从 TG 消息正文逐条提取每个链接的具体标题
- 智能合并：同键结果按完整度评分选最优（UniqueID +10, 链接 +5+个数, 内容 +3, 标题/10, 频道 +2）
- 排序打分：时间分（0-500）+ 关键词优先分（0-490）+ 插件等级分（-200~1000）
- Results 过滤：只有高质量结果（有时间/含优先关键词/高等级插件）进入 `results` 字段
- 密码提取：正则匹配（`提取码`/`密码`/`pwd`/`访问码`）+ URL 参数（`?pwd=`）

## 部署

### 1. Fork 仓库

### 2. 创建 Cloudflare KV Namespace

在 Cloudflare 控制台 → Workers & Pages → KV → 创建命名空间，命名为 `PLUGIN_KV`。记下 ID。

或通过 CLI：
```bash
npx wrangler kv:namespace create PLUGIN_KV
```

### 3. 配置 GitHub Secrets

仓库 Settings → Secrets and variables → Actions → Secrets：

**必填：**

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API Token（Edit Cloudflare Workers 模板） |
| `CLOUDFLARE_ACCOUNT_ID` | Cloudflare 账户 ID |
| `PLUGIN_KV_ID` | KV namespace ID |
| `ADMIN_PASSWORD` | 管理员密码 |

**可选（插件加密密钥，不设则用默认值）：**

| Secret |
|---|
| `PANLIAN_ENCRYPTION_KEY` |
| `GYING_ENCRYPTION_KEY` |
| `QQPD_ENCRYPTION_KEY` |
| `WEIBO_ENCRYPTION_KEY` |
| `PANLIAN_HASH_SALT` / `GYING_HASH_SALT` / `QQPD_HASH_SALT` / `WEIBO_HASH_SALT` |

### 4. 执行部署

Actions → Deploy to Cloudflare → Run workflow。

## 环境变量

所有变量在 `wrangler.toml` `[vars]` 中定义，由 CI 在部署时注入：

| 变量 | 说明 | 默认值 |
|---|---|---|
| `CHANNELS` | TG 频道列表 | `tgsearchers6` |
| `ENABLED_PLUGINS` | 启用的插件（空=全部） | 全部 |
| `ASYNC_PLUGIN_ENABLED` | 启用插件搜索 | `true` |
| `PLUGIN_TIMEOUT` | 单插件超时（秒） | `8` |
| `AUTH_ENABLED` | 开启认证 | `false` |
| `AUTH_USERS` | 用户 `user:pass,...` | - |
| `AUTH_JWT_SECRET` | JWT 密钥 | `pansou2cf-secret` |

## 本地开发

```bash
npm install
npm run dev          # Worker: http://localhost:8787

# Vue 前端（可选，生产由 Worker 直接提供静态文件）
cd pansou-web && npm install && npm run dev
```

## 插件系统

### 专用插件（3 个）

手写站点特定解析逻辑：`pansearch`（Build ID 提取 + JSON API）、`yunso`（HTML 结构化解析）、`alupan`（Article 块解析）

### 配置驱动插件（86 个）

通过 `configs.ts` 统一管理 URL 模板 + 解析模式。通用引擎自动尝试 JSON 解析，失败后回退 4 层 HTML 策略：Article 块 → List 项 → Card 布局 → 链接提取。

### 账号管理插件（4 个）

完整实现 Go 版中的 `PluginWithWebHandler` 接口，使用 KV 替代文件系统持久化会话。认证流程完全对齐 Go 版：
- Panlian/Gying：获取登录页 Cookie → POST 凭据 → 保存会话
- QQPD：获取 QR 码 → hash33(ptqrtoken) → 轮询 ptqrlogin → check_sig 取全量 Cookie
- Weibo：获取 QR 码(qrid) → 轮询 qrcode/check → 4 步 Cookie 初始化

## License

与原项目一致。
