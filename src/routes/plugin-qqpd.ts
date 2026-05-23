// QQPD plugin — QQ QR code login + channel search
import { Hono } from 'hono';
import { getConfig } from '../config';
import {
  getUser, saveUser, createUser, computeHash,
  parseCookies, mergeCookies, getSetCookieHeaders, isUserExpired,
  type PluginUser,
} from '../service/kv-session';

const NAMESPACE = 'qqpd';

function hash33(s: string): number {
  let e = 5381;
  for (let i = 0; i < s.length; i++) e += (e << 5) + s.charCodeAt(i);
  return e & 2147483647;
}

export function qqpdRoute(): Hono {
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
          if (qrResult) {
            await kv.put(`${NAMESPACE}:qrsig:${hash}`, qrResult.qrsig, { expirationTtl: 300 });
            qrcode = qrResult.base64;
          }
        }
        return c.json({
          logged_in: loggedIn, qq_masked: user.qqMasked || '',
          channels: user.channels || [], status: user.status,
          qrcode_base64: qrcode ? `data:image/png;base64,${qrcode}` : '',
        });
      }

      case 'refresh_qrcode': {
        const qrResult = await generateQR();
        if (!qrResult) return c.json({ error: '生成二维码失败' });
        await kv.put(`${NAMESPACE}:qrsig:${hash}`, qrResult.qrsig, { expirationTtl: 300 });
        return c.json({ qrcode_base64: `data:image/png;base64,${qrResult.base64}` });
      }

      case 'check_login': {
        const qrsig = await kv.get(`${NAMESPACE}:qrsig:${hash}`);
        if (!qrsig) return c.json({ login_status: 'expired', message: '二维码已过期，请刷新' });
        const result = await checkQRLogin(qrsig);
        if (result.status === 'success') {
          const cookies = await fetchQQCookies(result.url || '', result.uin || '');
          if (cookies) {
            const user = await getUser(kv, NAMESPACE, hash) || createUser(hash);
            user.cookie = cookies; user.status = 'active';
            user.qqMasked = result.uin ? result.uin.slice(0, 4) + '****' : '';
            user.loginAt = new Date().toISOString();
            user.expireAt = new Date(Date.now() + 2 * 86400000).toISOString();
            user.lastAccessAt = new Date().toISOString();
            await saveUser(kv, NAMESPACE, user);
            await kv.delete(`${NAMESPACE}:qrsig:${hash}`);
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

      case 'set_channels': {
        const user = await getUser(kv, NAMESPACE, hash) || createUser(hash);
        const channels: string[] = body.channels || [];
        user.channels = channels; user.channelGuildIDs = user.channelGuildIDs || {};
        for (const ch of channels) {
          if (!user.channelGuildIDs[ch]) {
            const gid = await resolveGuildID(user.cookie, ch);
            if (gid) user.channelGuildIDs[ch] = gid;
          }
        }
        await saveUser(kv, NAMESPACE, user);
        return c.json({ success: true, channels, channel_guild_ids: user.channelGuildIDs });
      }

      case 'test_search': {
        const keyword = body.keyword;
        if (!keyword) return c.json({ results: [], total: 0, message: '缺少搜索关键词' });
        const user = await getUser(kv, NAMESPACE, hash);
        if (!user || user.status !== 'active' || !user.cookie) return c.json({ results: [], total: 0, message: '未登录' });

        const refreshed = await refreshCookie(user.cookie);
        if (refreshed) { user.cookie = refreshed; await saveUser(kv, NAMESPACE, user); }

        try {
          const results = await doSearch(user.cookie, user.channels || [], user.channelGuildIDs || {}, keyword, body.max_results || 10);
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
    const hash = await computeHash(c.req.param('param'), config.qqpdHashSalt);
    return c.redirect(`/qqpd/${hash}`);
  });

  return r;
}

async function generateQR(): Promise<{ base64: string; qrsig: string } | null> {
  try {
    const res = await fetch('https://xui.ptlogin2.qq.com/ssl/ptqrshow?appid=1600001587&e=2&l=M&s=3&d=72&v=4&t=' + Math.random(), {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) return null;
    const buf = await res.arrayBuffer();
    const base64 = btoa(String.fromCharCode(...new Uint8Array(buf)));
    let qrsig = '';
    for (const c of getSetCookieHeaders(res)) {
      const m = c.match(/qrsig=([^;]+)/);
      if (m) { qrsig = m[1]; break; }
    }
    return { base64, qrsig };
  } catch { return null; }
}

async function checkQRLogin(qrsig: string): Promise<{ status: string; message: string; url?: string; uin?: string }> {
  try {
    const token = hash33(qrsig).toString();
    const url = `https://xui.ptlogin2.qq.com/ssl/ptqrlogin?u1=${encodeURIComponent('https://pd.qq.com/explore')}&ptqrtoken=${token}&ptredirect=1&h=1&t=1&g=1&from_ui=1&ptlang=2052&action=0-0-${Date.now()}&js_ver=25100115&js_type=1&login_sig=&pt_uistyle=40&aid=1600001587&daid=823`;
    const res = await fetch(url, {
      headers: { 'Cookie': `qrsig=${qrsig}`, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    const text = await res.text();
    if (text.includes('二维码已失效')) return { status: 'expired', message: '二维码已过期' };
    if (text.includes('登录成功')) {
      const urlMatch = text.match(/ptuiCB\('0','0','([^']+)'/);
      const uinMatch = (urlMatch?.[1] || '').match(/uin=(\d+)/);
      return { status: 'success', message: '登录成功', url: urlMatch?.[1] || '', uin: uinMatch?.[1] || '' };
    }
    if (text.includes('已经扫描')) return { status: 'scanned', message: '已扫描，请确认' };
    return { status: 'waiting', message: '等待扫码' };
  } catch { return { status: 'waiting', message: '检查中...' }; }
}

async function fetchQQCookies(redirectUrl: string, uin: string): Promise<string | null> {
  try {
    const res1 = await fetch(redirectUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      redirect: 'manual',
    });
    let cookies = parseCookies(getSetCookieHeaders(res1));
    const ptsigxMatch = redirectUrl.match(/ptsigx=([^&]+)/);
    if (uin && ptsigxMatch) {
      const checkUrl = `https://ptlogin2.pd.qq.com/check_sig?pttype=1&uin=${uin}&service=ptqrlogin&nodirect=1&ptsigx=${ptsigxMatch[1]}&s_url=${encodeURIComponent('https://pd.qq.com/explore')}`;
      const res2 = await fetch(checkUrl, { headers: { 'Cookie': cookies, 'User-Agent': 'Mozilla/5.0' } });
      cookies = mergeCookies(cookies, getSetCookieHeaders(res2));
    }
    const res3 = await fetch('https://pd.qq.com/explore', {
      headers: { 'Cookie': cookies, 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    cookies = mergeCookies(cookies, getSetCookieHeaders(res3));
    if (uin && !cookies.includes(`uin=o0${uin}`)) cookies = `uin=o0${uin}; ${cookies}`;
    return cookies || null;
  } catch { return null; }
}

async function refreshCookie(cookie: string): Promise<string | null> {
  try {
    const res = await fetch('https://pd.qq.com/explore', {
      headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0' }, redirect: 'manual',
    });
    const newHeaders = getSetCookieHeaders(res);
    return newHeaders.length ? mergeCookies(cookie, newHeaders) : null;
  } catch { return null; }
}

async function resolveGuildID(cookie: string, channel: string): Promise<string | null> {
  if (/^\d+$/.test(channel)) return channel;
  try {
    const res = await fetch(`https://pd.qq.com/g/${channel}`, { headers: { 'Cookie': cookie, 'User-Agent': 'Mozilla/5.0' }, redirect: 'follow' });
    const match = (await res.text()).match(/https:\/\/groupprohead\.gtimg\.cn\/(\d+)\//);
    return match?.[1] || null;
  } catch { return null; }
}

async function doSearch(cookie: string, channels: string[], guildIDs: Record<string, string>, keyword: string, maxResults: number): Promise<any[]> {
  const results: any[] = [];
  const skeyMatch = cookie.match(/skey=([^;]+)/);
  const bkn = skeyMatch ? hash33(skeyMatch[1]) : 0;

  for (const ch of channels.slice(0, 3)) {
    const guildID = guildIDs[ch] || ch;
    if (!guildID || results.length >= maxResults) break;
    try {
      const res = await fetch(`https://pd.qq.com/qunng/guild/gotrpc/auth/trpc.group_pro.in_guild_search_svr.InGuildSearch/NewSearch?bkn=${bkn}`, {
        method: 'POST',
        headers: {
          'Cookie': cookie, 'Content-Type': 'application/json',
          'x-oidb': '{"uint32_command":"0x9287","uint32_service_type":"2"}',
          'Referer': 'https://pd.qq.com/', 'Origin': 'https://pd.qq.com',
          'User-Agent': 'Mozilla/5.0',
        },
        body: JSON.stringify({
          guild_id: guildID, query: keyword, cookie: '', member_cookie: '',
          search_type: { type: 0, feed_type: 0 }, cond: { channel_ids: [], feed_rank_type: 0, type_list: [2, 3] },
        }),
      });
      const data = await res.json() as any;
      const feeds = data?.data?.union_result?.guild_feeds || [];
      for (const feed of feeds) {
        if (results.length >= maxResults) break;
        const text = (feed.content || '') + ' ' + (feed.title || '');
        const links = extractPanLinks(text);
        if (links.length > 0) {
          results.push({
            title: feed.title || keyword, content: feed.content || '',
            links: links.map(l => ({ url: l.url, password: l.password, type: l.type })),
            images: (feed.images || []).map((img: any) => img.url || '').filter(Boolean),
            datetime: feed.create_time ? new Date(Number(feed.create_time) * 1000).toISOString() : new Date().toISOString(),
            channel: `qqpd:${ch}`,
          });
        }
      }
    } catch {}
  }
  return results;
}

const PAN_RE: Array<{ re: RegExp; type: string }> = [
  { re: /https?:\/\/pan\.quark\.cn\/s\/[0-9A-Za-z]+/gi, type: 'quark' },
  { re: /https?:\/\/(?:www\.)?aliyundrive\.com\/s\/[0-9A-Za-z]+/gi, type: 'aliyun' },
  { re: /https?:\/\/www\.alipan\.com\/s\/[0-9A-Za-z]+/gi, type: 'aliyun' },
  { re: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z_-]+/gi, type: 'baidu' },
  { re: /https?:\/\/www\.123pan\.com\/s\/[0-9A-Za-z]+/gi, type: '123' },
  { re: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z]+/gi, type: 'xunlei' },
  { re: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/gi, type: 'uc' },
  { re: /https?:\/\/115\.com\/s\/[0-9A-Za-z]+/gi, type: '115' },
  { re: /https?:\/\/cloud\.189\.cn\/t\/[0-9A-Za-z]+/gi, type: 'tianyi' },
];

function extractPanLinks(text: string): Array<{ url: string; password: string; type: string }> {
  const links: Array<{ url: string; password: string; type: string }> = [];
  const seen = new Set<string>();
  for (const { re, type } of PAN_RE) {
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
