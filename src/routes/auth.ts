import { Hono } from 'hono';
import { getConfig } from '../config';

const authRoute = new Hono();

async function signToken(user: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const header = { alg: 'HS256', typ: 'JWT' };
  const payload = { user, exp: Math.floor(Date.now() / 1000) + 86400, iat: Math.floor(Date.now() / 1000) };
  const b64header = btoa(JSON.stringify(header)).replace(/=+$/, '');
  const b64payload = btoa(JSON.stringify(payload)).replace(/=+$/, '');
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(b64header + '.' + b64payload));
  const b64sig = btoa(String.fromCharCode(...new Uint8Array(sig))).replace(/=+$/, '').replace(/\+/g, '-').replace(/\//g, '_');
  return b64header + '.' + b64payload + '.' + b64sig;
}

async function verifyTokenSelf(token: string, secret: string): Promise<{ user: string } | null> {
  try {
    const parts = token.split('.');
    if (parts.length !== 3) return null;
    const payload = JSON.parse(atob(parts[1]));
    if (payload.exp * 1000 < Date.now()) return null;

    // Verify HMAC-SHA256 signature
    const enc = new TextEncoder();
    const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['verify']);
    const data = enc.encode(parts[0] + '.' + parts[1]);
    // Convert base64url sig to raw bytes
    const sigB64 = parts[2].replace(/-/g, '+').replace(/_/g, '/');
    const sigRaw = Uint8Array.from(atob(sigB64), c => c.charCodeAt(0));
    const valid = await crypto.subtle.verify('HMAC', key, sigRaw, data);
    if (!valid) return null;

    return { user: payload.user };
  } catch { return null; }
}

// POST /api/auth/login — matches Go: returns {token, expires_at, username}
authRoute.post('/login', async (c) => {
  const config = getConfig(c.env as any);
  if (!config.authEnabled) {
    return c.json({ error: '认证功能未启用' }, 403);
  }
  if (config.authUsers.size === 0) {
    return c.json({ error: '认证系统未正确配置' }, 500);
  }

  let body: any;
  try { body = await c.req.json(); } catch { return c.json({ error: '请求格式错误' }, 400); }

  const { username, password } = body;
  if (!username || !password) {
    return c.json({ error: '用户名和密码不能为空' }, 400);
  }

  const storedPass = config.authUsers.get(username);
  if (!storedPass || storedPass !== password) {
    return c.json({ error: '用户名或密码错误' }, 401);
  }

  try {
    const token = await signToken(username, config.authJwtSecret);
    const expiresAt = Math.floor(Date.now() / 1000) + 86400;
    return c.json({ token, expires_at: expiresAt, username });
  } catch {
    return c.json({ error: '生成令牌失败' }, 500);
  }
});

// POST /api/auth/verify — matches Go
authRoute.post('/verify', async (c) => {
  const config = getConfig(c.env as any);
  if (!config.authEnabled) {
    return c.json({ valid: true, message: '认证功能未启用' });
  }

  const auth = c.req.header('Authorization') || '';
  if (!auth.startsWith('Bearer ')) {
    return c.json({ error: '未授权' }, 401);
  }

  const token = auth.slice(7);
  const claims = await verifyTokenSelf(token, config.authJwtSecret);
  if (!claims) {
    return c.json({ error: '未授权：令牌无效或已过期' }, 401);
  }

  return c.json({ valid: true, username: claims.user });
});

// POST /api/auth/logout
authRoute.post('/logout', (c) => {
  return c.json({ message: '退出成功' });
});

export { authRoute, verifyTokenSelf };
