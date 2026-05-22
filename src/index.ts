import { Hono } from 'hono';
import { getConfig } from './config';
import { searchRoute } from './routes/search';
import { authRoute } from './routes/auth';
import { checkRoute } from './routes/check';
import { getFiltered } from './plugin/registry';

// Import all plugins to trigger registration
import './plugin/pansearch';
import './plugin/yunso';
import './plugin/yunsou';
import './plugin/qupansou';
import './plugin/pan666';
import './plugin/haisou';
import './plugin/alupan';
import './plugin/panlian';
import './plugin/sousou';
import './plugin/panta';

const app = new Hono();

// CORS
app.use('*', async (c, next) => {
  c.res.headers.set('Access-Control-Allow-Origin', '*');
  c.res.headers.set('Access-Control-Allow-Methods', 'GET, POST, OPTIONS');
  c.res.headers.set('Access-Control-Allow-Headers', 'Content-Type, Authorization');
  if (c.req.method === 'OPTIONS') return new Response(null, { status: 204 });
  await next();
});

// Auth middleware
app.use('/api/*', async (c, next) => {
  const config = getConfig(c.env);
  if (!config.authEnabled) return next();

  const publicPaths = ['/api/auth/login', '/api/health'];
  if (publicPaths.includes(c.req.path)) return next();

  const auth = c.req.header('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return c.json({ code: 401, message: '未授权', data: null }, 401);
  }
  // Token verification is handled by individual routes
  await next();
});

// Routes
app.route('/api/search', searchRoute);
app.route('/api/auth', authRoute);
app.route('/api/check', checkRoute);

app.get('/api/health', (c) => {
  const config = getConfig(c.env);
  const plugins = getFiltered(config.enabledPlugins || []);
  return c.json({
    status: 'ok',
    auth_enabled: config.authEnabled,
    plugins_enabled: config.asyncPluginEnabled,
    channels: config.channels,
    channels_count: config.channels.length,
    plugin_count: plugins.length,
    plugins: plugins.map(p => p.name),
  });
});

// Root page
app.get('/', (c) => {
  const config = getConfig(c.env);
  const plugins = getFiltered(config.enabledPlugins || []);
  return c.html(`<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width, initial-scale=1.0">
<title>PanSou2CF - 网盘资源搜索</title>
<style>
  * { margin:0; padding:0; box-sizing:border-box; }
  body { font-family:-apple-system,BlinkMacSystemFont,'Segoe UI',sans-serif; background:#f5f5f5; min-height:100vh; display:flex; flex-direction:column; align-items:center; padding:20px; }
  .container { max-width:700px; width:100%; }
  .header { text-align:center; margin:40px 0 30px; }
  .header h1 { font-size:28px; color:#333; margin-bottom:8px; }
  .header p { color:#888; font-size:14px; }
  .search-box { background:#fff; border-radius:12px; padding:20px; box-shadow:0 2px 12px rgba(0,0,0,0.08); margin-bottom:20px; }
  .search-box input { width:100%; padding:12px 16px; border:2px solid #e0e0e0; border-radius:8px; font-size:16px; outline:none; transition:border-color .2s; }
  .search-box input:focus { border-color:#4f46e5; }
  .search-box button { width:100%; margin-top:12px; padding:12px; background:#4f46e5; color:#fff; border:none; border-radius:8px; font-size:16px; cursor:pointer; transition:background .2s; }
  .search-box button:hover { background:#4338ca; }
  .info { background:#fff; border-radius:12px; padding:20px; box-shadow:0 2px 12px rgba(0,0,0,0.08); }
  .info h3 { font-size:16px; color:#333; margin-bottom:12px; }
  .info .row { display:flex; justify-content:space-between; padding:8px 0; border-bottom:1px solid #f0f0f0; font-size:14px; color:#666; }
  .info .row:last-child { border-bottom:none; }
  .info .row span:last-child { color:#333; font-weight:500; }
  .links { margin-top:20px; text-align:center; }
  .links a { color:#4f46e5; text-decoration:none; font-size:14px; margin:0 8px; }
  .links a:hover { text-decoration:underline; }
  .result { background:#fff; border-radius:12px; padding:20px; box-shadow:0 2px 12px rgba(0,0,0,0.08); margin-top:20px; display:none; max-height:500px; overflow-y:auto; }
  .result pre { font-size:12px; white-space:pre-wrap; word-break:break-all; }
  #loading { text-align:center; color:#888; margin-top:20px; display:none; }
</style>
</head>
<body>
<div class="container">
  <div class="header">
    <h1>PanSou2CF</h1>
    <p>网盘资源搜索 API &middot; Cloudflare Workers</p>
  </div>
  <div class="search-box">
    <input type="text" id="kw" placeholder="输入搜索关键词..." autofocus>
    <button onclick="doSearch()">搜索</button>
  </div>
  <div id="loading">搜索中...</div>
  <div class="result" id="result"><pre id="resultText"></pre></div>
  <div class="info">
    <h3>服务状态</h3>
    <div class="row"><span>插件数量</span><span>${plugins.length}</span></div>
    <div class="row"><span>TG频道</span><span>${config.channels.length} 个</span></div>
    <div class="row"><span>认证</span><span>${config.authEnabled ? '已开启' : '未开启'}</span></div>
  </div>
  <div class="links">
    <a href="/api/search?kw=测试">API 搜索示例</a>
    <a href="/api/health">健康检查</a>
  </div>
</div>
<script>
async function doSearch() {
  const kw = document.getElementById('kw').value.trim();
  if (!kw) return;
  document.getElementById('loading').style.display = 'block';
  document.getElementById('result').style.display = 'none';
  try {
    const res = await fetch('/api/search?kw=' + encodeURIComponent(kw));
    const data = await res.json();
    document.getElementById('resultText').textContent = JSON.stringify(data, null, 2);
    document.getElementById('result').style.display = 'block';
  } catch(e) {
    document.getElementById('resultText').textContent = '请求失败: ' + e.message;
    document.getElementById('result').style.display = 'block';
  }
  document.getElementById('loading').style.display = 'none';
}
document.getElementById('kw').addEventListener('keydown', e => { if(e.key==='Enter') doSearch(); });
</script>
</body>
</html>`);
});

// 404 — return JSON for API paths, redirect others to /
app.notFound((c) => {
  if (c.req.path.startsWith('/api')) {
    return c.json({ code: 404, message: 'Not Found' }, 404);
  }
  return c.redirect('/');
});

export default app;
