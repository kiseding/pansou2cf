# PanSou2CF

PanSou 网盘资源搜索 API 的 Cloudflare Workers 移植版。在原版 Go 项目基础上，将全部 89 个搜索插件、链路检测、认证系统等完整迁移到 TypeScript，可直接部署在 Cloudflare Workers 免费额度内运行。

## 与原项目的对应关系

| PanSou (Go) | PanSou2CF (TypeScript) |
|---|---|
| `main.go` / gin router | `src/index.ts` / Hono |
| `config/config.go` | `src/config.ts` |
| `model/*.go` | `src/types.ts` |
| `plugin/plugin.go` + 70+ 插件 | `src/plugin/registry.ts` + 89 个配置驱动插件 |
| `api/handler.go` | `src/routes/search.ts` |
| `service/search_service.go` | `src/service/search.ts` |
| `service/check_service.go` | `src/service/check.ts` |
| `util/cache/*` | Cloudflare Cache API |

## API 接口

### 搜索

```
GET  /api/search?kw=关键词
POST /api/search
```

| 参数 | 类型 | 说明 | 默认值 |
|---|---|---|---|
| `kw` | string | 搜索关键词（必填） | - |
| `src` | string | 数据来源：`all` / `tg` / `plugin` | `all` |
| `plugins` | string | 指定插件，逗号分隔。空字符串=全部启用 | 全部 |
| `channels` | string | TG 频道，逗号分隔 | `tgsearchers6` |
| `conc` | int | 并发数 | 10 |
| `refresh` | bool | 强制刷新，绕过缓存 | false |
| `res` | string | 返回格式：`merged_by_type` / `results` | `merged_by_type` |
| `cloud_types` | string | 网盘类型过滤：`quark,baidu,alipan,xunlei,uc,123` | 全部 |
| `filter` | json | 关键词过滤 `{"include":["4K"],"exclude":["短剧"]}` | - |

**响应格式：**

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 100,
    "results": [{
      "message_id": "pansearch_0",
      "unique_id": "https://pan.quark.cn/s/abc123",
      "channel": "plugin:pansearch",
      "datetime": "2025-01-15T10:30:00Z",
      "title": "资源标题",
      "content": "",
      "links": [
        { "type": "quark", "url": "https://pan.quark.cn/s/abc123", "password": "提取码" }
      ],
      "images": []
    }],
    "merged_by_type": {
      "quark": [
        { "url": "https://pan.quark.cn/s/abc123", "password": "提取码", "note": "资源标题", "datetime": "...", "source": "plugin:pansearch" }
      ],
      "baidu": [...],
      "alipan": [...],
      "xunlei": [...],
      "uc": [...],
      "123": [...]
    }
  }
}
```

### 链接可用性检测

```
POST /api/check/links
```

支持 9 种网盘的 API 级验证，自动识别链接类型或手动指定：

```
# 自动检测类型
POST /api/check/links
{ "links": ["https://pan.quark.cn/s/abc123", "https://pan.baidu.com/s/1xyz?pwd=test"] }

# 手动指定
POST /api/check/links
{ "items": [{ "diskType": "quark", "url": "https://pan.quark.cn/s/abc123", "password": "提取码" }] }
```

响应：

```json
{
  "code": 0,
  "data": {
    "total": 1,
    "results": [{
      "diskType": "quark",
      "url": "https://pan.quark.cn/s/abc123",
      "state": "ok",
      "cacheHit": false,
      "summary": "链接有效"
    }]
  }
}
```

状态说明：

| state | 含义 | 缓存 TTL |
|---|---|---|
| `ok` | 链接有效 | 24 小时 |
| `bad` | 链接失效/违规/删除 | 6 小时 |
| `locked` | 需要提取码 | 12 小时 |
| `unsupported` | 暂不支持该网盘 | 24 小时 |
| `uncertain` | 无法确认状态 | 30 分钟 |

**支持的网盘类型：**

| 类型 | 标识 | 验证方式 |
|---|---|---|
| 夸克网盘 | `quark` | Token API → Detail API 两步验证 |
| 百度网盘 | `baidu` | 密码验证 → 列表 API |
| 阿里云盘 | `aliyun` | Share API 匿名获取 |
| UC 网盘 | `uc` | 页面内容检测 |
| 123 云盘 | `123` | Share Info API |
| 迅雷网盘 | `xunlei` | Share API（含解压） |
| 115 网盘 | `115` | Snap API |
| 天翼云盘 | `tianyi` | XML API |
| 移动云盘 | `mobile` | 暂不支持（需 AES 加密） |

### 认证

```
POST /api/auth/login    { "username": "admin", "password": "admin" }
POST /api/auth/verify   { "token": "..." }
POST /api/auth/logout
```

### 健康检查

```
GET /api/health
```

```json
{
  "status": "ok",
  "auth_enabled": false,
  "plugins_enabled": true,
  "channels": ["tgsearchers6"],
  "plugin_count": 89,
  "plugins": ["pansearch", "yunso", ...]
}
```

## 部署

### 准备工作

- [Cloudflare 账号](https://dash.cloudflare.com)
- [GitHub 账号](https://github.com)

### 步骤

**1. Fork 本仓库**

**2. 获取 Cloudflare API Token**

Cloudflare 控制台 → 右上角头像 → **我的个人资料** → **API 令牌** → 创建令牌 → 选择 **"编辑 Cloudflare Workers"** 模板 → 复制 Token。

账户 ID 在控制台首页右侧面板。

**3. 配置 GitHub Secrets**

仓库 Settings → Secrets and variables → Actions → Secrets，添加：

| Secret | 说明 |
|---|---|
| `CLOUDFLARE_API_TOKEN` | API Token |
| `CLOUDFLARE_ACCOUNT_ID` | 账户 ID |

**4. 执行部署**

Actions → **Deploy to Cloudflare** → Run workflow。

### 环境变量

在 Cloudflare 控制台 → Workers & Pages → pansou2cf → Settings → Variables 中可配置：

| 变量 | 说明 | 默认值 |
|---|---|---|
| `CHANNELS` | TG 频道列表，逗号分隔 | `tgsearchers6` |
| `ENABLED_PLUGINS` | 启用的插件列表。空字符串=全部启用 | 全部 89 个 |
| `ASYNC_PLUGIN_ENABLED` | 是否启用插件搜索 | `true` |
| `PLUGIN_TIMEOUT` | 单个插件超时（秒） | `8` |
| `ASYNC_RESPONSE_TIMEOUT` | 异步响应超时（秒） | `4` |
| `AUTH_ENABLED` | 是否开启认证 | `false` |
| `AUTH_USERS` | 用户列表 `user:pass,user:pass` | - |
| `AUTH_JWT_SECRET` | JWT 签名密钥 | `pansou2cf-secret` |
| `ADMIN_USERNAME` | 管理员用户名 | `admin` |
| `ADMIN_PASSWORD` | 管理员密码 | `admin` |

## 插件系统

89 个搜索插件，覆盖各类网盘资源搜索源。分为两类：

### 专用插件（3 个）
- **pansearch** — pansearch.me 全功能解析（Build ID 提取 + JSON API）
- **yunso** — 小云搜索 HTML 结构化解析
- **alupan** — 阿鹿盘 Article 块解析

### 配置驱动插件（86 个）

通过 `configs.ts` 统一管理，支持两种解析模式：

- **JSON API 模式**（14 个）：haisou、sousou、mikuclub、miaoso、ouge、feikuai、xdyh、zhizhen、bixin、wanou、meitizy、nsgame、quark4k、discourse — 自动解析 JSON 响应，提取 `data.results` 等路径
- **HTML 多策略模式**（72 个）：通过 Article/List/Card/Link 四层解析策略提取网盘链接

通用引擎自动尝试 JSON 解析，失败后回退到 HTML 解析。

## 搜索结果排序

与原版一致的三维排序算法：

- **时间分**（0-500）：越新的资源分越高
- **关键词优先分**（0-490）：标题含"合集""系列""最新"等关键词加分
- **插件等级分**（-200~1000）：高优先级插件的排前面

## 本地开发

```
npm install
npm run dev        # 启动 http://localhost:8787
```

## 架构

```
src/
  index.ts            # Hono 应用入口 + 中间件
  config.ts           # 环境变量配置解析
  types.ts            # 类型定义
  routes/
    search.ts         # GET/POST /api/search
    auth.ts           # /api/auth/* 认证
    check.ts          # /api/check/links 链路检测
  service/
    search.ts         # 搜索编排：并发、缓存、去重、排序
    check.ts          # 9 种网盘的 API 级验证
  plugin/
    registry.ts       # 插件注册表
    boot.ts           # 启动引导
    configs.ts        # 89 个插件配置（URL + 解析模式）
    config-engine.ts  # 通用解析引擎（JSON + HTML 多策略）
    pansearch.ts      # pansearch 专用插件
    yunso.ts          # yunso 专用插件
    alupan.ts         # alupan 专用插件
  pages/
    home.ts           # SPA 首页
    ui.ts             # 前端 JavaScript
```

## License

与原项目一致。
