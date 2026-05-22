// Environment configuration — reads from Cloudflare Worker env bindings

export interface Env {
  CHANNELS?: string;
  ASYNC_PLUGIN_ENABLED?: string;
  ENABLED_PLUGINS?: string;
  ASYNC_RESPONSE_TIMEOUT?: string;
  PLUGIN_TIMEOUT?: string;
  AUTH_ENABLED?: string;
  AUTH_USERS?: string;
  AUTH_JWT_SECRET?: string;
  ADMIN_USERNAME?: string;
  ADMIN_PASSWORD?: string;
  REGISTER_CODE?: string;
}

export interface AppConfig {
  channels: string[];
  asyncPluginEnabled: boolean;
  enabledPlugins: string[] | null;
  asyncResponseTimeout: number;
  pluginTimeout: number;
  authEnabled: boolean;
  authUsers: Map<string, string>;
  authJwtSecret: string;
}

let _config: AppConfig | null = null;

export function getConfig(env?: any): AppConfig {
  if (_config && !env) return _config;

  const e = (env || {}) as Env;

  const authUsers = parseAuthUsers(e.AUTH_USERS || '');
  // Always include admin from env vars
  const adminUser = e.ADMIN_USERNAME || 'admin';
  const adminPass = e.ADMIN_PASSWORD || 'admin';
  if (adminPass) authUsers.set(adminUser, adminPass);

  _config = {
    channels: (e.CHANNELS || 'tgsearchers6').split(',').map((s: string) => s.trim()).filter(Boolean),
    asyncPluginEnabled: e.ASYNC_PLUGIN_ENABLED !== 'false',
    enabledPlugins: parsePluginList(e.ENABLED_PLUGINS),
    asyncResponseTimeout: parseInt(e.ASYNC_RESPONSE_TIMEOUT || '4'),
    pluginTimeout: parseInt(e.PLUGIN_TIMEOUT || '30'),
    authEnabled: e.AUTH_ENABLED === 'true',
    authUsers,
    authJwtSecret: e.AUTH_JWT_SECRET || 'pansou2cf-secret',
  };

  return _config;
}

function parsePluginList(env: string | undefined): string[] | null {
  if (env === undefined) return null;
  if (env === '') return [];
  return env.split(',').map((s: string) => s.trim()).filter(Boolean);
}

function parseAuthUsers(env: string): Map<string, string> {
  const m = new Map<string, string>();
  if (!env) return m;
  for (const pair of env.split(',')) {
    const [user, pass] = pair.split(':');
    if (user && pass) m.set(user.trim(), pass.trim());
  }
  return m;
}
