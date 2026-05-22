import { Hono } from 'hono';
import { getConfig } from '../config';
import { successResponse, errorResponse } from '../types';

const authRoute = new Hono();

async function signToken(user: string, secret: string): Promise<string> {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey('raw', enc.encode(secret), { name: 'HMAC', hash: 'SHA-256' }, false, ['sign']);
  const payload = JSON.stringify({ user, exp: Date.now() + 86400000 });
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(payload));
  return btoa(payload) + '.' + btoa(String.fromCharCode(...new Uint8Array(sig)));
}

authRoute.post('/login', async (c) => {
  const config = getConfig(c.env);
  if (!config.authEnabled) {
    return c.json(successResponse({ token: 'no-auth-required' }));
  }
  try {
    const { username, password } = await c.req.json();
    const storedPass = config.authUsers.get(username);
    if (!storedPass || storedPass !== password) {
      return c.json(errorResponse(401, '用户名或密码错误'), 401);
    }
    const token = await signToken(username, config.authJwtSecret);
    return c.json(successResponse({ token, expires_in: 86400 }));
  } catch {
    return c.json(errorResponse(400, '请求格式错误'), 400);
  }
});

authRoute.post('/verify', async (c) => {
  const config = getConfig(c.env);
  if (!config.authEnabled) return c.json(successResponse({ valid: true }));
  try {
    const { token } = await c.req.json();
    const parts = token?.split('.');
    if (!parts || parts.length !== 2) return c.json(errorResponse(401, '无效Token'), 401);
    const payload = JSON.parse(atob(parts[0]));
    if (payload.exp < Date.now()) return c.json(errorResponse(401, 'Token已过期'), 401);
    return c.json(successResponse({ valid: true, user: payload.user }));
  } catch {
    return c.json(errorResponse(401, 'Token验证失败'), 401);
  }
});

authRoute.post('/logout', (c) => {
  return c.json(successResponse({ message: '已登出' }));
});

export { authRoute };
