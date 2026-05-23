import { Hono } from 'hono';
import { getConfig } from './config';
import { searchRoute } from './routes/search';
import { authRoute, verifyTokenSelf } from './routes/auth';
import { checkRoute } from './routes/check';
import { getFiltered } from './plugin/registry';
import { bootPlugins } from './plugin/boot';
import { panlianRoute } from './routes/plugin-panlian';
import { qqpdRoute } from './routes/plugin-qqpd';
import { gyingRoute } from './routes/plugin-gying';
import { weiboRoute } from './routes/plugin-weibo';
bootPlugins();

const app = new Hono();

// CORS
app.use('*', async (c, next) => {
  c.res.headers.set('Access-Control-Allow-Origin', '*');
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204 });
  await next();
});

// Auth middleware — protects all /api/* and plugin routes (matching Go behavior)
app.use('/api/*', authGuard);
app.use('/qqpd/*', authGuard);
app.use('/gying/*', authGuard);
app.use('/panlian/*', authGuard);
app.use('/weibo/*', authGuard);

async function authGuard(c: any, next: any) {
  const config = getConfig(c.env);
  if (!config.authEnabled) return next();

  const path = c.req.path;
  // Public paths (no auth required) — matching Go
  const isPublic = path === '/api/auth/login' || path === '/api/auth/logout' || path === '/api/health'
    || path.startsWith('/api/auth/') && (path.endsWith('/login') || path.endsWith('/logout'));
  if (isPublic) return next();

  const authHeader = c.req.header('Authorization') || '';
  if (!authHeader) {
    return c.json({ error: '未授权：缺少认证令牌', code: 'AUTH_TOKEN_MISSING' }, 401);
  }
  if (!authHeader.startsWith('Bearer ')) {
    return c.json({ error: '未授权：令牌格式错误', code: 'AUTH_TOKEN_INVALID_FORMAT' }, 401);
  }

  const token = authHeader.slice(7);
  const claims = verifyTokenSelf(token, config.authJwtSecret);
  if (!claims) {
    return c.json({ error: '未授权：令牌无效或已过期', code: 'AUTH_TOKEN_INVALID' }, 401);
  }
  c.set('username', claims.user);
  await next();
}

// API routes
app.route('/api/search', searchRoute);
app.route('/api/auth', authRoute);
app.route('/api/check', checkRoute);

app.get('/api/health', (c) => {
  const config = getConfig(c.env);
  const plugins = getFiltered(config.enabledPlugins);
  return c.json({
    status: 'ok', auth_enabled: config.authEnabled,
    plugins_enabled: config.asyncPluginEnabled,
    channels: config.channels, channels_count: config.channels.length,
    plugin_count: plugins.length, plugins: plugins.map(p => p.name),
  });
});

// Plugin account management routes (KV-backed)
app.route('/qqpd', qqpdRoute());
app.route('/gying', gyingRoute());
app.route('/panlian', panlianRoute());
app.route('/weibo', weiboRoute());

// SPA fallback: for client-side routes, serve index.html
// Static files (/assets/*, /favicon.ico) are handled by wrangler [assets]
app.notFound((c) => {
  if (c.req.path.startsWith('/api')) return c.json({ code: 404, message: 'Not Found' }, 404);
  // Return index.html for SPA client-side routing
  return c.html(FALLBACK_HTML);
});

const FALLBACK_HTML = `<!DOCTYPE html>
<html lang="zh-CN">
<head>
  <meta charset="UTF-8">
  <meta name="viewport" content="width=device-width,initial-scale=1.0">
  <title>PanSou - 网盘资源搜索</title>
  <link rel="icon" type="image/x-icon" href="/favicon.ico">
</head>
<body>
  <div id="app">
    <div style="text-align:center;padding:100px 20px;font-family:-apple-system,BlinkMacSystemFont,sans-serif">
      <div style="font-size:48px;margin-bottom:16px">&#x1F50D;</div>
      <p style="font-size:16px;color:#64748b">Loading PanSou...</p>
      <p style="font-size:13px;color:#94a3b8;margin-top:8px">If this persists, please check your deployment.</p>
    </div>
  </div>
</body>
</html>`;

export default app;

