// Weibo plugin — QR code login + user blog search
import { Hono } from 'hono';
import { getConfig } from '../config';
import {
  getUser, saveUser, createUser, computeHash,
  parseCookies, mergeCookies, getSetCookieHeaders, isUserExpired,
  type PluginUser,
} from '../service/kv-session';

const NAMESPACE = 'weibo';

export function weiboRoute(): Hono {
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
        let qrcode = '';
        const loggedIn = user.status === 'active' && !isUserExpired(user);
        if (!loggedIn) {
          const qrResult = await generateQR();
          if (qrResult) { await kv.put(`${NAMESPACE}:qrid:${hash}`, qrResult.qrid, { expirationTtl: 300 }); qrcode = qrResult.base64; }
        }
        return c.json({
          logged_in: loggedIn, user_ids: user.userIDs || [], status: user.status,
          qrcode_base64: qrcode ? `data:image/png;base64,${qrcode}` : '',
        });
      }

      case 'refresh_qrcode': {
        const qrResult = await generateQR();
        if (!qrResult) return c.json({ error: '生成二维码失败' });
        await kv.put(`${NAMESPACE}:qrid:${hash}`, qrResult.qrid, { expirationTtl: 300 });
        return c.json({ qrcode_base64: `data:image/png;base64,${qrResult.base64}` });
      }

      case 'check_login': {
        const qrid = await kv.get(`${NAMESPACE}:qrid:${hash}`);
        if (!qrid) return c.json({ login_status: 'expired', message: '二维码已过期，请刷新' });
        const result = await checkQRLogin(qrid);
        if (result.status === 'success' && result.altURL) {
          const cookies = await initCookies(result.altURL);
          if (cookies) {
            const user = await getUser(kv, NAMESPACE, hash) || createUser(hash);
            user.cookie = cookies; user.status = 'active';
            user.loginAt = new Date().toISOString();
            user.expireAt = new Date(Date.now() + 30 * 86400000).toISOString();
            user.lastAccessAt = new Date().toISOString();
            await saveUser(kv, NAMESPACE, user);
            await kv.delete(`${NAMESPACE}:qrid:${hash}`);
          }
          return c.json({ login_status: 'success', message: '登录成功' });
        }
        return c.json({ login_status: result.status, message: result.message });
      }

      case 'logout': {
        const user = await getUser(kv, NAMESPACE, hash);
        if (user) { user.cookie = ''; user.status = 'pending'; await saveUser(kv, NAMESPACE, user); }
        return c.json({ message: '已登出' });
      }

      case 'set_user_ids': {
        const user = await getUser(kv, NAMESPACE, hash) || createUser(hash);
        user.userIDs = body.user_ids || []; await saveUser(kv, NAMESPACE, user);
        return c.json({ success: true, user_ids: user.userIDs });
      }

      case 'test_search': {
        const keyword = body.keyword;
        const maxResults = body.max_results || 10;
        if (!keyword) return c.json({ results: [], total: 0, message: '缺少搜索关键词' });
        const user = await getUser(kv, NAMESPACE, hash);
        if (!user || user.status !== 'active' || !user.cookie) return c.json({ results: [], total: 0, message: '未登录' });
        const refreshed = await refreshCookie(user.cookie);
        if (refreshed) { user.cookie = refreshed; await saveUser(kv, NAMESPACE, user); }
        try {
          const results = await doSearch(user.cookie, user.userIDs || [], keyword, maxResults);
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
    const hash = await computeHash(c.req.param('param'), config.weiboHashSalt);
    return c.redirect(`/weibo/${hash}`);
  });

  return r;
}

async function generateQR(): Promise<{ base64: string; qrid: string } | null> {
  try {
    const ts = Date.now();
    const metaRes = await fetch(`https://passport.weibo.com/sso/v2/qrcode/image?entry=miniblog&size=180&callback=STK_${ts}`, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Referer': 'https://weibo.com/' },
    });
    const text = await metaRes.text();
    let metaData: any;
    try { const jm = text.match(/\((\{[\s\S]*\})\)/); metaData = jm ? JSON.parse(jm[1]) : JSON.parse(text); } catch { return null; }
    const meta = metaData?.data || metaData;
    const qrid = meta?.qrid || '';
    if (!qrid) return null;

    const apiKey = text.match(/api_key=([^"&]+)/)?.[1] || '';
    const qrURL = apiKey ? `https://v2.qr.weibo.cn/inf/gen?api_key=${apiKey}` : `https://v2.qr.weibo.cn/inf/gen?qrid=${qrid}`;
    const qrRes = await fetch(qrURL, { headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://passport.weibo.com/' } });
    if (!qrRes.ok) return null;
    const buf = await qrRes.arrayBuffer();
    return { base64: btoa(String.fromCharCode(...new Uint8Array(buf))), qrid };
  } catch { return null; }
}

async function checkQRLogin(qrid: string): Promise<{ status: string; message: string; altURL?: string }> {
  try {
    const ts = Date.now();
    const res = await fetch(`https://passport.weibo.com/sso/v2/qrcode/check?entry=sso&qrid=${qrid}&callback=STK_${ts}`, {
      headers: { 'User-Agent': 'Mozilla/5.0', 'Referer': 'https://passport.weibo.com/' },
    });
    const text = await res.text();
    let data: any;
    try { const jm = text.match(/\((\{[\s\S]*\})\)/); data = jm ? JSON.parse(jm[1]) : JSON.parse(text); } catch { return { status: 'waiting', message: '检查中...' }; }
    switch (data?.retcode) {
      case 20000000: return { status: 'success', message: '登录成功', altURL: data?.data?.url || '' };
      case 50114001: return { status: 'waiting', message: '等待扫码' };
      case 50114002: return { status: 'scanned', message: '已扫描，请确认' };
      case 50114004: return { status: 'expired', message: '二维码已过期' };
      default: return { status: 'waiting', message: data?.msg || '等待扫码' };
    }
  } catch { return { status: 'waiting', message: '检查中...' }; }
}

async function initCookies(altURL: string): Promise<string | null> {
  try {
    let cookies = '';
    const res1 = await fetch(altURL, { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' } });
    cookies = mergeCookies(cookies, getSetCookieHeaders(res1));
    const res2 = await fetch('https://weibo.com/', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Cookie': cookies } });
    cookies = mergeCookies(cookies, getSetCookieHeaders(res2));
    const res3 = await fetch('https://m.weibo.cn/', { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15', 'Cookie': cookies } });
    cookies = mergeCookies(cookies, getSetCookieHeaders(res3));
    const res4 = await fetch('https://m.weibo.cn/profile', { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15', 'Cookie': cookies } });
    cookies = mergeCookies(cookies, getSetCookieHeaders(res4));
    return cookies || null;
  } catch { return null; }
}

async function refreshCookie(cookie: string): Promise<string | null> {
  try {
    let c = cookie;
    const res1 = await fetch('https://weibo.com/', { headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Cookie': c } });
    c = mergeCookies(c, getSetCookieHeaders(res1));
    const res2 = await fetch('https://m.weibo.cn/', { headers: { 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15', 'Cookie': c } });
    c = mergeCookies(c, getSetCookieHeaders(res2));
    return c === cookie ? null : c;
  } catch { return null; }
}

async function doSearch(cookie: string, userIDs: string[], keyword: string, maxResults: number): Promise<any[]> {
  const results: any[] = [];
  for (const uid of userIDs || []) {
    if (results.length >= maxResults) break;
    for (let page = 1; page <= 3; page++) {
      if (results.length >= maxResults) break;
      try {
        const res = await fetch(`https://weibo.com/ajax/profile/searchblog?uid=${uid}&feature=0&q=${encodeURIComponent(keyword)}&page=${page}`, {
          headers: { 'Cookie': cookie, 'Accept': 'application/json', 'Referer': `https://weibo.com/u/${uid}`, 'User-Agent': 'Mozilla/5.0' },
        });
        const data = await res.json() as any;
        const posts = data?.data?.list || [];
        if (!Array.isArray(posts) || posts.length === 0) break;

        for (const post of posts) {
          if (results.length >= maxResults) break;
          const text = post.text_raw || post.text || '';
          const cleanText = text.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
          let panLinks = extractPanLinks(cleanText);

          // Process url_struct for redirect URLs
          if (panLinks.length === 0 && post.url_struct) {
            for (const uo of (Array.isArray(post.url_struct) ? post.url_struct : [])) {
              const longURL = uo.long_url || uo.url || '';
              if (!longURL || guessType(longURL) !== 'unknown') continue;
              try {
                const extRes = await fetch(longURL, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
                panLinks.push(...extractPanLinks(await extRes.text()));
              } catch {}
            }
          }

          // Try comments if no links found
          if (panLinks.length === 0 && post.mblogid) {
            try {
              const cr = await fetch(`https://m.weibo.cn/comments/hotflow?id=${post.mblogid}&mid=${post.mblogid}&max_id=0&max_id_type=0`, {
                headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0 (iPhone; CPU iPhone OS 16_0 like Mac OS X) AppleWebKit/605.1.15', 'Referer': 'https://m.weibo.cn/' },
              });
              const cd = await cr.json() as any;
              for (const c of (cd?.data?.data || [])) {
                const ct = (c.text || '').replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ');
                const shortURLs = ct.match(/https?:\/\/weibo\.cn\/sinaurl\?u=[^\s"'<>]+/g) || [];
                for (const su of shortURLs) {
                  try {
                    const du = decodeURIComponent(su.match(/u=([^&]+)/)?.[1] || su);
                    if (guessType(du) !== 'unknown') { panLinks.push({ url: du, password: '', type: guessType(du) }); }
                    else { const xr = await fetch(du, { headers: { 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' }); panLinks.push(...extractPanLinks(await xr.text())); }
                  } catch {}
                }
              }
            } catch {}
          }

          if (panLinks.length > 0) {
            results.push({ title: cleanText.slice(0, 100), content: cleanText, links: panLinks, images: (post.pics || []).map((img: any) => img.url || img.large?.url || '').filter(Boolean), datetime: post.created_at || new Date().toISOString(), source: `weibo:${uid}` });
          }
        }
      } catch {}
    }
  }
  return results;
}

const P: Array<{ re: RegExp; type: string }> = [
  { re: /https?:\/\/pan\.quark\.cn\/s\/[0-9A-Za-z]+/gi, type: 'quark' },
  { re: /https?:\/\/www\.alipan\.com\/s\/[0-9A-Za-z]+/gi, type: 'aliyun' },
  { re: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z_-]+/gi, type: 'baidu' },
  { re: /https?:\/\/www\.123pan\.com\/s\/[0-9A-Za-z]+/gi, type: '123' },
  { re: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z]+/gi, type: 'xunlei' },
  { re: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/gi, type: 'uc' },
  { re: /https?:\/\/115\.com\/s\/[0-9A-Za-z]+/gi, type: '115' },
  { re: /https?:\/\/mypikpak\.com\/s\/[0-9A-Za-z]+/gi, type: 'pikpak' },
];

function extractPanLinks(text: string): Array<{ url: string; password: string; type: string }> {
  const links: Array<{ url: string; password: string; type: string }> = [];
  const seen = new Set<string>();
  for (const { re, type } of P) {
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
  if (u.includes('pan.quark')) return 'quark'; if (u.includes('pan.baidu')) return 'baidu';
  if (u.includes('aliyun')) return 'aliyun'; if (u.includes('pan.xunlei')) return 'xunlei';
  if (u.includes('drive.uc')) return 'uc'; if (u.includes('123pan')) return '123';
  if (u.includes('115')) return '115'; return 'unknown';
}
