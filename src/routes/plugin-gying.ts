// Gying plugin — username/password login to gying.net
import { Hono } from 'hono';
import { getConfig } from '../config';
import {
  getUser, saveUser, createUser, computeHash,
  encryptPassword, parseCookies, mergeCookies, getSetCookieHeaders, isUserExpired,
  getConfig as getKVConfig, setConfig as setKVConfig,
  type PluginUser,
} from '../service/kv-session';

const NAMESPACE = 'gying';

export function gyingRoute(): Hono {
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
          status: user.status, username: user.username || '',
          login_time: user.loginAt, expire_time: user.expireAt,
          expires_in_days: user.expireAt ? Math.max(0, Math.ceil((new Date(user.expireAt).getTime() - Date.now()) / 86400000)) : 0,
        });
      }

      case 'get_config': {
        const bu = await getKVConfig<string>(kv, NAMESPACE, 'base_url');
        return c.json({ base_url: bu || 'https://www.gying.net' });
      }

      case 'update_config': {
        const bu = body.base_url || 'https://www.gying.net';
        await setKVConfig(kv, NAMESPACE, 'base_url', bu);
        return c.json({ success: true, base_url: bu });
      }

      case 'login': {
        const { username, password } = body;
        if (!username || !password) return c.json({ success: false, message: '缺少用户名或密码' });
        try {
          const bu = (await getKVConfig<string>(kv, NAMESPACE, 'base_url')) || 'https://www.gying.net';
          const result = await doLogin(bu, username, password);
          if (!result.success) return c.json(result);

          const user = await getUser(kv, NAMESPACE, hash) || createUser(hash);
          user.username = username;
          user.encryptedPassword = await encryptPassword(password, config.gyingEncryptionKey);
          user.cookie = result.cookie!; user.baseURL = bu;
          user.status = 'active'; user.loginAt = new Date().toISOString();
          user.expireAt = new Date(Date.now() + 120 * 86400000).toISOString();
          user.lastAccessAt = new Date().toISOString();
          await saveUser(kv, NAMESPACE, user);
          return c.json({ success: true, message: '登录成功', username });
        } catch (e: any) {
          return c.json({ success: false, message: e?.message || '登录失败' });
        }
      }

      case 'logout': {
        const user = await getUser(kv, NAMESPACE, hash);
        if (user) { user.cookie = ''; user.status = 'pending'; await saveUser(kv, NAMESPACE, user); }
        return c.json({ success: true, message: '已登出' });
      }

      case 'test_search': {
        const keyword = body.keyword;
        if (!keyword) return c.json({ results: [], total: 0, message: '缺少搜索关键词' });
        const user = await getUser(kv, NAMESPACE, hash);
        if (!user || user.status !== 'active' || !user.cookie) return c.json({ results: [], total: 0, message: '未登录或会话已过期' });
        try {
          const results = await doSearch(user.baseURL || 'https://www.gying.net', user.cookie, keyword, body.max_results || 10);
          return c.json({ results, total: results.length, message: 'ok' });
        } catch (e: any) {
          return c.json({ results: [], total: 0, message: e?.message || '搜索失败' });
        }
      }

      default: return c.json({ error: '未知操作' }, 400);
    }
  });

  r.get('/:param', async (c) => {
    const config = getConfig(c.env as any);
    const hash = await computeHash(c.req.param('param'), config.gyingHashSalt);
    return c.redirect(`/gying/${hash}`);
  });

  return r;
}

async function doLogin(baseURL: string, username: string, password: string): Promise<{ success: boolean; message: string; cookie?: string }> {
  let initCookies = '';
  try {
    const homeRes = await fetch(baseURL + '/', {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36' },
    });
    initCookies = parseCookies(getSetCookieHeaders(homeRes));
  } catch {}

  const params = new URLSearchParams();
  params.append('code', ''); params.append('siteid', '1'); params.append('dosubmit', '1');
  params.append('cookietime', '10506240');
  params.append('username', username); params.append('password', password);

  const loginRes = await fetch(`${baseURL}/user/login`, {
    method: 'POST',
    headers: {
      'Content-Type': 'application/x-www-form-urlencoded', 'Cookie': initCookies,
      'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0.0.0 Safari/537.36',
      'Origin': baseURL, 'Referer': baseURL + '/',
    },
    body: params.toString(),
  });

  const allCookies = mergeCookies(initCookies, getSetCookieHeaders(loginRes));
  const data = await loginRes.json() as any;
  if (data.code === 200 || data.code === '200' || data.success) {
    try {
      const detailRes = await fetch(`${baseURL}/mv/wkMn`, {
        headers: { 'Cookie': allCookies, 'User-Agent': 'Mozilla/5.0' },
      });
      return { success: true, message: 'ok', cookie: mergeCookies(allCookies, getSetCookieHeaders(detailRes)) };
    } catch {
      return { success: true, message: 'ok', cookie: allCookies };
    }
  }
  return { success: false, message: data.message || data.msg || '登录失败' };
}

async function doSearch(baseURL: string, cookie: string, keyword: string, maxResults: number): Promise<any[]> {
  const res = await fetch(`${baseURL}/search?q=${encodeURIComponent(keyword)}&type=0&mode=2`, {
    headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0', 'Accept': 'text/html' },
  });
  const html = await res.text();
  const searchMatch = html.match(/_obj\.search\s*=\s*(\{[\s\S]*?\});/);
  if (!searchMatch) return [];

  let searchData: any;
  try { searchData = JSON.parse(searchMatch[1]); } catch {
    try { searchData = JSON.parse(searchMatch[1].replace(/\\"/g, '"').replace(/\\\\/g, '\\')); } catch { return []; }
  }
  const items = searchData?.results || searchData?.data || searchData?.list || [];
  if (!Array.isArray(items) || items.length === 0) return [];

  const results: any[] = [];
  for (const item of items.slice(0, maxResults)) {
    const title = item.title || item.name || '';
    const type = item.type || ''; const id = item.id || item.res_id || '';
    if (!id) continue;
    try {
      const detailRes = await fetch(`${baseURL}/res/downurl/${type}/${id}`, {
        headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      });
      if (!detailRes.ok) continue;
      const ct = detailRes.headers.get('content-type') || '';
      if (ct.includes('json')) {
        const detailData = await detailRes.json() as any;
        const links = detailData?.links || detailData?.data?.links || detailData?.list || [];
        for (const link of (Array.isArray(links) ? links : [links])) {
          const url = link.url || link.href || link.pan_url || '';
          if (!url) continue;
          results.push({ title, url, password: link.password || link.pwd || '', type: link.type || link.pan_type || guessType(url), source: 'gying', datetime: new Date().toISOString() });
        }
      } else {
        const detailHTML = await detailRes.text();
        const panLinks = extractPanLinks(detailHTML);
        for (const link of panLinks) {
          results.push({ title, url: link.url, password: link.password, type: link.type, source: 'gying', datetime: new Date().toISOString() });
        }
      }
    } catch {}
  }
  return results;
}

const PATTERNS: Array<{ re: RegExp; type: string }> = [
  { re: /https?:\/\/pan\.quark\.cn\/s\/[0-9A-Za-z]+/gi, type: 'quark' },
  { re: /https?:\/\/www\.alipan\.com\/s\/[0-9A-Za-z]+/gi, type: 'aliyun' },
  { re: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z_-]+/gi, type: 'baidu' },
  { re: /https?:\/\/www\.123pan\.com\/s\/[0-9A-Za-z]+/gi, type: '123' },
  { re: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z]+/gi, type: 'xunlei' },
  { re: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/gi, type: 'uc' },
  { re: /https?:\/\/115\.com\/s\/[0-9A-Za-z]+/gi, type: '115' },
];

function extractPanLinks(text: string): Array<{ url: string; password: string; type: string }> {
  const links: Array<{ url: string; password: string; type: string }> = [];
  const seen = new Set<string>();
  for (const { re, type } of PATTERNS) {
    re.lastIndex = 0; let m;
    while ((m = re.exec(text)) !== null) {
      const url = m[0].replace(/&amp;/g, '&');
      if (seen.has(url)) continue; seen.add(url);
      const ctx = text.substring(Math.max(0, m.index - 50), m.index + m[0].length + 50);
      const pwdMatch = ctx.match(/(?:提取码|密码|pwd)[:：=]\s*([0-9A-Za-z]{4,8})/i);
      links.push({ url, password: pwdMatch?.[1] || '', type });
    }
  }
  return links;
}

function guessType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('quark')) return 'quark'; if (u.includes('baidu')) return 'baidu';
  if (u.includes('aliyun')) return 'aliyun'; if (u.includes('xunlei')) return 'xunlei';
  if (u.includes('drive.uc')) return 'uc'; if (u.includes('123pan')) return '123';
  if (u.includes('115.com')) return '115'; return 'unknown';
}
