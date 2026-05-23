import { Hono } from 'hono';
import { getConfig } from './config';
import { searchRoute } from './routes/search';
import { authRoute } from './routes/auth';
import { checkRoute } from './routes/check';
import { getFiltered } from './plugin/registry';
import { bootPlugins } from './plugin/boot';
import { pluginStubRoute } from './routes/plugin-stubs';
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

// Auth middleware (API only)
app.use('/api/*', async (c, next) => {
  const config = getConfig(c.env);
  if (!config.authEnabled) return next();
  const publicPaths = ['/api/auth/login', '/api/health'];
  if (publicPaths.includes(c.req.path)) return next();
  const auth = c.req.header('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return c.json({ code: 401, message: '未授权', data: null }, 401);
  }
  await next();
});

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

// Plugin account management stubs (Vue frontend expects these endpoints)
app.route('/qqpd', pluginStubRoute('qqpd'));
app.route('/gying', pluginStubRoute('gying'));
app.route('/panlian', pluginStubRoute('panlian'));
app.route('/weibo', pluginStubRoute('weibo'));

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

