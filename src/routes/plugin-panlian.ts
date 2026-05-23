// Panlian plugin — username/password login to pinglian.lol
import { Hono } from 'hono';
import { getConfig } from '../config';
import {
  getUser, saveUser, createUser, computeHash,
  encryptPassword, decryptPassword,
  parseCookies, mergeCookies, getSetCookieHeaders, isUserExpired,
  type PluginUser,
} from '../service/kv-session';

const NAMESPACE = 'panlian';
const LOGIN_URL = 'https://pinglian.lol/pages/login.php';
const LOGIN_API = 'https://pinglian.lol/api/login.php';
const VIDEOS_API = 'https://pinglian.lol/api/get_videos.php';
const LINKS_API = 'https://pinglian.lol/api/search_pan_links.php';

export function panlianRoute(): Hono {
  const r = new Hono();

  r.post('/:hash', async (c) => {
    const config = getConfig(c.env as any);
    const kv = (c.env as any).PLUGIN_KV as KVNamespace;
    if (!kv) return c.json({ error: 'KV binding not configured' }, 500);

    const hash = c.req.param('hash');
    let body: any;
    try { body = await c.req.json(); } catch { return c.json({ error: 'Invalid JSON' }, 400); }
    const action = body.action || '';

    switch (action) {
      case 'get_status': {
        let user = await getUser(kv, NAMESPACE, hash);
        if (!user) user = createUser(hash);
        return c.json({
          logged_in: user.status === 'active' && !isUserExpired(user),
          status: user.status,
          username: user.username || '',
          login_time: user.loginAt,
          expire_time: user.expireAt,
          expires_in_days: user.expireAt ? Math.max(0, Math.ceil((new Date(user.expireAt).getTime() - Date.now()) / 86400000)) : 0,
          blocked_pan_types: user.blockedPanTypes || [],
        });
      }

      case 'login': {
        const { username, password, remember } = body;
        if (!username || !password) return c.json({ success: false, message: '缺少用户名或密码' });

        try {
          const result = await doLogin(username, password);
          if (!result.success) return c.json(result);

          const user = await getUser(kv, NAMESPACE, hash) || createUser(hash);
          user.username = username;
          user.encryptedPassword = await encryptPassword(password, config.panlianEncryptionKey);
          user.cookie = result.cookie!;
          user.status = 'active';
          user.loginAt = new Date().toISOString();
          user.expireAt = new Date(Date.now() + (remember ? 30 : 7) * 86400000).toISOString();
          user.lastAccessAt = new Date().toISOString();
          await saveUser(kv, NAMESPACE, user);

          return c.json({ success: true, message: '登录成功', username });
        } catch (e: any) {
          return c.json({ success: false, message: e?.message || '登录失败' });
        }
      }

      case 'logout': {
        const user = await getUser(kv, NAMESPACE, hash);
        if (user) {
          user.cookie = '';
          user.status = 'pending';
          user.lastAccessAt = new Date().toISOString();
          await saveUser(kv, NAMESPACE, user);
        }
        return c.json({ success: true, message: '已登出' });
      }

      case 'update_config': {
        const user = await getUser(kv, NAMESPACE, hash) || createUser(hash);
        user.blockedPanTypes = body.blocked_pan_types || [];
        user.lastAccessAt = new Date().toISOString();
        await saveUser(kv, NAMESPACE, user);
        return c.json({ success: true, blocked_pan_types: user.blockedPanTypes });
      }

      case 'test_search': {
        const keyword = body.keyword;
        if (!keyword) return c.json({ results: [], total: 0, message: '缺少搜索关键词' });

        const user = await getUser(kv, NAMESPACE, hash);
        if (!user || user.status !== 'active' || !user.cookie) {
          return c.json({ results: [], total: 0, message: '未登录或会话已过期' });
        }

        try {
          const results = await doSearch(user.cookie, keyword, user.blockedPanTypes || []);
          return c.json({ results: results.slice(0, 10), total: results.length, message: 'ok' });
        } catch (e: any) {
          return c.json({ results: [], total: 0, message: e?.message || '搜索失败' });
        }
      }

      default:
        return c.json({ error: '未知操作' }, 400);
    }
  });

  r.get('/:param', async (c) => {
    const config = getConfig(c.env as any);
    const param = c.req.param('param');
    const hash = await computeHash(param, config.panlianHashSalt);
    return c.redirect(`/panlian/${hash}`);
  });

  return r;
}

// ── Login flow ──

async function doLogin(username: string, password: string): Promise<{ success: boolean; message: string; cookie?: string }> {
  const pageRes = await fetch(LOGIN_URL, {
    headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
    redirect: 'manual',
  });
  const initCookies = parseCookies(getSetCookieHeaders(pageRes));

  const form = new FormData();
  form.append('username', username);
  form.append('password', password);
  form.append('remember', 'on');

  const loginRes = await fetch(LOGIN_API, {
    method: 'POST',
    headers: {
      'Cookie': initCookies,
      'X-Requested-With': 'XMLHttpRequest',
      'Origin': 'https://pinglian.lol',
      'Referer': LOGIN_URL,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36',
    },
    body: form,
    redirect: 'manual',
  });

  const allCookies = mergeCookies(initCookies, getSetCookieHeaders(loginRes));
  const data = await loginRes.json() as any;
  if (data.success) return { success: true, message: 'ok', cookie: allCookies };
  return { success: false, message: data.message || '登录失败' };
}

async function doSearch(cookie: string, keyword: string, blockedTypes: string[]): Promise<any[]> {
  const videosRes = await fetch(`${VIDEOS_API}?wd=${encodeURIComponent(keyword)}&pg=1`, {
    headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' },
  });
  const videoData = await videosRes.json() as any;
  const videos = videoData?.data || videoData?.videos || [];
  if (!Array.isArray(videos) || videos.length === 0) return [];

  const results: any[] = [];
  for (const video of videos.slice(0, 5)) {
    const title = video.title || video.name || '';
    const id = video.id || video.vod_id || '';
    if (!id) continue;

    const linksRes = await fetch(`${LINKS_API}?keyword=${encodeURIComponent(title)}&vod_id=${encodeURIComponent(id)}&_t=${Date.now()}`, {
      headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'application/json' },
    });
    const linksData = await linksRes.json() as any;
    const links = linksData?.data || linksData?.links || [];

    if (Array.isArray(links) && links.length > 0) {
      for (const link of links) {
        const url = link.url || link.pan_url || link.link || '';
        const type = link.type || link.pan_type || guessPanType(url);
        if (!url) continue;
        if (blockedTypes.includes(type)) continue;
        results.push({ title, url, password: link.password || link.pwd || '', type, source: 'panlian', datetime: new Date().toISOString() });
      }
    }
  }
  return results.slice(0, 200);
}

function guessPanType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('quark')) return 'quark'; if (u.includes('baidu')) return 'baidu';
  if (u.includes('aliyun')) return 'aliyun'; if (u.includes('xunlei')) return 'xunlei';
  if (u.includes('drive.uc')) return 'uc'; if (u.includes('123pan')) return '123';
  if (u.includes('115.com')) return '115'; return 'unknown';
}
