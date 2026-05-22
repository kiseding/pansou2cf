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

// 404
app.notFound((c) => c.json({ code: 404, message: 'Not Found' }, 404));

export default app;
