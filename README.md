# pansou2cf

PanSou 网盘资源搜索 API 的 Cloudflare Workers 移植版。与原项目接口和响应格式一致。

## API 接口

### 搜索

```
GET /api/search?kw=关键词
POST /api/search
```

参数：

| 参数 | 类型 | 说明 | 默认值 |
|------|------|------|--------|
| kw | string | 搜索关键词（必填） | - |
| channels | string | TG频道，逗号分隔 | tgsearchers6 |
| conc | int | 并发搜索数 | 20 |
| refresh | bool | 强制刷新缓存 | false |
| res | string | 返回类型：results / merged_by_type | merged_by_type |
| src | string | 数据来源：all / tg / plugin | all |
| plugins | string | 指定插件，逗号分隔 | 全部已启用 |
| cloud_types | string | 网盘类型过滤，逗号分隔 | 全部 |
| filter | json | 关键词过滤 {include:[], exclude:[]} | - |

### 响应格式

```json
{
  "code": 0,
  "message": "success",
  "data": {
    "total": 100,
    "results": [...],
    "merged_by_type": {
      "quark": [{"url": "...", "password": "", "note": "标题", "datetime": "..."}],
      "baidu": [...]
    }
  }
}
```

### 其他接口

- `GET /api/health` — 健康检查
- `POST /api/auth/login` — 登录（需开启认证）
- `POST /api/auth/verify` — 验证 Token
- `POST /api/auth/logout` — 登出
- `POST /api/check/links` — 检查链接可用性

## 部署到 Cloudflare

### 准备工作

需要一个 [Cloudflare 账号](https://dash.cloudflare.com) 和一个 [GitHub 账号](https://github.com)。

### 第一步：Fork 仓库

点击仓库页面右上角的 Fork 按钮将 pansou2cf 复制到你的账号下。

### 第二步：获取 API Token

登录 Cloudflare 控制台，点击右上角头像 → **我的个人资料** → **API 令牌**，创建一个 API 令牌，选择 **"编辑 Cloudflare Workers"** 模板，复制 Token 值。

Cloudflare 账户 ID 在控制台首页右侧面板中可以找到。

### 第三步：配置 GitHub Secrets

进入你 Fork 后的仓库，点击 **Settings** → **Secrets and variables** → **Actions** → **Secrets**，添加：

- `CLOUDFLARE_API_TOKEN` — 第二步获取的 API Token
- `CLOUDFLARE_ACCOUNT_ID` — 你的 Cloudflare 账户 ID

### 第四步：执行部署

进入仓库的 **Actions** 标签页，左侧选择 **"Deploy to Cloudflare"**，点击右侧 **Run workflow** 执行。

部署成功后得到 `*.workers.dev` 域名，访问 `/api/search?kw=测试` 验证。

### 配置环境变量（可选）

在 Cloudflare 控制台 → Workers & Pages → pansou2cf → **Settings** → **Variables** 中可设置：

| 变量 | 说明 | 默认值 |
|------|------|--------|
| CHANNELS | TG频道列表 | tgsearchers6 |
| ENABLED_PLUGINS | 启用的插件 | pansearch,yunso,yunsou,... |
| AUTH_ENABLED | 是否开启认证 | false |
| AUTH_USERS | 用户列表 user:pass,user:pass | - |
| ASYNC_RESPONSE_TIMEOUT | 响应超时秒数 | 4 |
| PLUGIN_TIMEOUT | 插件超时秒数 | 30 |

## 本地开发

```
npm install
npm run dev
```

本地启动后访问 `http://localhost:8787/api/search?kw=测试`。

## 与原项目的对应关系

| PanSou (Go) | pansou2cf (TS) |
|-------------|----------------|
| main.go | src/index.ts |
| config/config.go | src/config.ts |
| model/*.go | src/types.ts |
| plugin/plugin.go | src/plugin/registry.ts |
| 70+ 个 Go 插件 | 10 个 TS 插件 |
| api/handler.go | src/routes/search.ts |
| service/search_service.go | src/service/search.ts |
