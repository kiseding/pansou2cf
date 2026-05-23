// Link validation service — ported from Go check_service.go
// Validates 9 disk types: quark, baidu, aliyun, uc, tianyi, 123, xunlei, 115, mobile

interface CheckItem {
  diskType: string;
  url: string;
  password?: string;
}

interface CheckResult {
  diskType: string;
  url: string;
  normalizedURL?: string;
  state: 'ok' | 'bad' | 'locked' | 'unsupported' | 'uncertain';
  cacheHit: boolean;
  checkedAt: number;
  expiresAt: number;
  summary: string;
}

interface CachedEntry {
  result: CheckResult;
  expiresAt: number;
}

const stateTTL: Record<string, number> = {
  ok: 24 * 3600_000,
  bad: 6 * 3600_000,
  locked: 12 * 3600_000,
  unsupported: 24 * 3600_000,
  uncertain: 30 * 60_000,
};

// In-memory cache (per-Worker-isolate)
const cacheMap = new Map<string, CachedEntry>();
const inflightMap = new Map<string, { done: Promise<void>; result?: CheckResult; err?: string }>();

const UA = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36';

function ttlForState(state: string): number {
  return stateTTL[state] || 30 * 60_000;
}

function buildResult(item: CheckItem, normalized: string, state: CheckResult['state'], cacheHit: boolean, summary: string): CheckResult {
  const now = Date.now();
  return {
    diskType: item.diskType,
    url: item.url,
    normalizedURL: normalized,
    state,
    cacheHit,
    checkedAt: now,
    expiresAt: now + ttlForState(state),
    summary,
  };
}

function normalizeURL(rawURL: string, diskType: string, password: string): string {
  let url = rawURL.trim();
  if (!url) return '';
  try {
    const parsed = new URL(url);
    parsed.hash = '';
    parsed.host = parsed.host.toLowerCase();
    if (password && ['baidu', 'quark', 'uc'].includes(diskType)) {
      if (!parsed.searchParams.has('pwd')) {
        parsed.searchParams.set('pwd', password);
      }
    }
    url = parsed.toString();
  } catch {}
  return url;
}

function containsAny(text: string, keywords: string[]): boolean {
  const lower = text.toLowerCase();
  return keywords.some(k => lower.includes(k.toLowerCase()));
}

// ─── Check implementations per disk type ───

async function checkQuark(item: CheckItem, normalized: string): Promise<CheckResult> {
  const re = /\/s\/([A-Za-z0-9]+)/;
  const match = normalized.match(re);
  if (!match) return buildResult(item, normalized, 'uncertain', false, '无法解析分享地址');
  const resourceID = match[1];

  const parsed = (() => { try { return new URL(normalized); } catch { return null; } })();
  const password = parsed?.searchParams.get('pwd') || item.password || '';

  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch('https://drive-h.quark.cn/1/clouddrive/share/sharepage/token', {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json',
        Origin: 'https://pan.quark.cn',
        Referer: 'https://pan.quark.cn/',
        'User-Agent': UA,
      },
      body: JSON.stringify({
        pwd_id: resourceID,
        passcode: password,
        support_visit_limit_private_share: true,
      }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const data = await res.json() as any;

    switch (data.code) {
      case 0: break;
      case 41008: return buildResult(item, normalized, 'locked', false, '需要提取码');
      case 41004: case 41010: case 41011:
        return buildResult(item, normalized, 'bad', false, '链接失效');
      default: {
        const msg = data.message || '';
        if (containsAny(msg, ['不存在', '失效', '违规', '过期', '取消']))
          return buildResult(item, normalized, 'bad', false, msg);
        if (containsAny(msg, ['提取码', '密码']))
          return buildResult(item, normalized, 'locked', false, msg);
        return buildResult(item, normalized, 'uncertain', false, msg);
      }
    }

    const stoken = data.data?.stoken || '';
    if (!stoken) return buildResult(item, normalized, 'uncertain', false, '访问令牌缺失');

    const detailURL = `https://drive-pc.quark.cn/1/clouddrive/share/sharepage/detail?pwd_id=${encodeURIComponent(resourceID)}&stoken=${encodeURIComponent(stoken)}&ver=2&pr=ucpro`;
    const ctrl2 = new AbortController();
    const t2 = setTimeout(() => ctrl2.abort(), 10_000);
    const detailRes = await fetch(detailURL, {
      headers: { Accept: 'application/json, text/plain, */*', Origin: 'https://pan.quark.cn', Referer: 'https://pan.quark.cn/', 'Cache-Control': 'no-cache', 'User-Agent': UA },
      signal: ctrl2.signal,
    });
    clearTimeout(t2);
    const detail = await detailRes.json() as any;

    if (detail.code === 0 && (detail.data?.list?.length > 0)) {
      return buildResult(item, normalized, 'ok', false, '链接有效');
    }
    return buildResult(item, normalized, 'uncertain', false, '无法确认链接状态');
  } catch {
    return buildResult(item, normalized, 'uncertain', false, '请求失败');
  }
}

async function checkBaidu(item: CheckItem, normalized: string): Promise<CheckResult> {
  try {
    const parsed = new URL(normalized);
    const pathParts = parsed.pathname.replace(/^\/+/, '').split('/');
    let shareID = '';
    let shortURL = '';
    const password = parsed.searchParams.get('pwd') || item.password || '';

    if (pathParts[0] === 's' && pathParts[1]) {
      shareID = pathParts[1];
      shortURL = shareID;
      if (shortURL.startsWith('1') && shortURL.length > 1) shortURL = shortURL.slice(1);
    } else if (pathParts[0] === 'share' && pathParts[1] === 'init') {
      shareID = parsed.searchParams.get('surl') || '';
      shortURL = shareID;
      if (shortURL.startsWith('1') && shortURL.length > 1) shortURL = shortURL.slice(1);
    }

    if (!shareID) return buildResult(item, normalized, 'uncertain', false, '无法解析分享地址');

    let bdclnd = '';
    if (password) {
      const verifyURL = `https://pan.baidu.com/share/verify?surl=${encodeURIComponent(shortURL)}&pwd=${encodeURIComponent(password)}`;
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 12_000);
      const res = await fetch(verifyURL, {
        method: 'POST',
        headers: { Referer: normalized, 'Content-Type': 'application/x-www-form-urlencoded', 'User-Agent': UA },
        body: new URLSearchParams({ pwd: password, vcode: '', vcode_str: '' }),
        signal: ctrl.signal,
      });
      clearTimeout(t);
      const data = await res.json() as any;
      switch (data.errno) {
        case 0: bdclnd = data.randsk; break;
        case -9: case -12: return buildResult(item, normalized, 'locked', false, '提取码错误或缺失');
        default: return buildResult(item, normalized, 'uncertain', false, data.errmsg || '');
      }
    }

    const listURL = `https://pan.baidu.com/share/list?web=1&page=1&num=20&order=time&desc=1&showempty=0&shorturl=${encodeURIComponent(shortURL)}&root=1&clienttype=0`;
    const headers: Record<string, string> = {
      Accept: 'application/json, text/plain, */*',
      Referer: normalized,
      'User-Agent': UA,
    };
    if (bdclnd) headers['Cookie'] = `BDCLND=${bdclnd}`;

    const ctrl2 = new AbortController();
    const t2 = setTimeout(() => ctrl2.abort(), 12_000);
    const listRes = await fetch(listURL, { headers, signal: ctrl2.signal });
    clearTimeout(t2);
    const listData = await listRes.json() as any;

    switch (listData.errno) {
      case 0: return (listData.list?.length > 0) ? buildResult(item, normalized, 'ok', false, '链接有效') : buildResult(item, normalized, 'bad', false, '链接失效');
      case -9: case -12: return buildResult(item, normalized, 'locked', false, '需要提取码');
      case -7: case 105: case 115: case 117: case 145: return buildResult(item, normalized, 'bad', false, '链接失效');
      default: return buildResult(item, normalized, 'uncertain', false, listData.errmsg || '');
    }
  } catch {
    return buildResult(item, normalized, 'uncertain', false, '请求失败');
  }
}

async function checkAliyun(item: CheckItem, normalized: string): Promise<CheckResult> {
  try {
    const parsed = new URL(normalized);
    const parts = parsed.pathname.replace(/^\/+/,'').split('/');
    const shareID = parts[parts.length - 1] || '';
    if (!shareID) return buildResult(item, normalized, 'uncertain', false, '无法解析分享地址');

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const res = await fetch(`https://api.aliyundrive.com/adrive/v3/share_link/get_share_by_anonymous?share_id=${shareID}`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', Origin: 'https://www.alipan.com', Referer: 'https://www.alipan.com/', 'x-canary': 'client=web,app=share,version=v2.3.1', 'User-Agent': UA },
      body: JSON.stringify({ share_id: shareID }),
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const data = await res.json() as any;

    if (res.ok && (data.share_name || data.share_title)) return buildResult(item, normalized, 'ok', false, '链接有效');
    if (containsAny(data.code || '', ['NotFound', 'Cancelled'])) return buildResult(item, normalized, 'bad', false, '链接失效');
    return buildResult(item, normalized, 'uncertain', false, data.message || '');
  } catch {
    return buildResult(item, normalized, 'uncertain', false, '请求失败');
  }
}

async function checkUC(item: CheckItem, normalized: string): Promise<CheckResult> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(normalized, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Linux; Android 10; Mobile) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 404) return buildResult(item, normalized, 'bad', false, '链接失效');
    const text = (await res.text()).toLowerCase();
    if (containsAny(text, ['失效', '不存在', '违规', '删除', '已过期', '被取消'])) return buildResult(item, normalized, 'bad', false, '链接失效');
    if (containsAny(text, ['提取码', '访问码', '请输入密码'])) return buildResult(item, normalized, 'locked', false, '需要提取码');
    if (containsAny(text, ['文件', '分享', 'drive.uc.cn'])) return buildResult(item, normalized, 'ok', false, '链接有效');
    return buildResult(item, normalized, 'uncertain', false, '无法确认链接状态');
  } catch {
    return buildResult(item, normalized, 'uncertain', false, '请求失败');
  }
}

async function check123(item: CheckItem, normalized: string): Promise<CheckResult> {
  try {
    const parsed = new URL(normalized);
    const parts = parsed.pathname.replace(/^\/+/, '').split('/');
    const shareKey = parts[parts.length - 1] || '';
    if (!shareKey) return buildResult(item, normalized, 'uncertain', false, '无法解析分享地址');

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8_000);
    const res = await fetch(`https://www.123pan.com/api/share/info?shareKey=${encodeURIComponent(shareKey)}`, {
      signal: ctrl.signal, headers: { 'User-Agent': UA },
    });
    clearTimeout(t);
    if (res.status === 403) return buildResult(item, normalized, 'ok', false, '链接有效');
    const data = await res.json() as any;
    if (data.code === 0) return buildResult(item, normalized, 'ok', false, '链接有效');
    if (data.data?.HasPwd) return buildResult(item, normalized, 'locked', false, '需要提取码');
    return buildResult(item, normalized, 'bad', false, data.message || '链接失效');
  } catch {
    return buildResult(item, normalized, 'uncertain', false, '请求失败');
  }
}

async function checkXunlei(item: CheckItem, normalized: string): Promise<CheckResult> {
  try {
    const re = /pan\.xunlei\.com\/s\/([^?/#]+)/;
    const match = normalized.match(re);
    if (!match) return buildResult(item, normalized, 'uncertain', false, '无法解析分享地址');
    const shareID = match[1];
    const parsed = (() => { try { return new URL(normalized); } catch { return null; } })();
    const password = parsed?.searchParams.get('pwd') || item.password || '';

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 12_000);
    const apiURL = `https://api-pan.xunlei.com/drive/v1/share?share_id=${encodeURIComponent(shareID)}&pass_code=${encodeURIComponent(password)}&limit=100&pass_code_token=&page_token=&thumbnail_size=SIZE_SMALL`;
    const res = await fetch(apiURL, {
      headers: {
        Accept: '*/*', 'Content-Type': 'application/json',
        Origin: 'https://pan.xunlei.com', Referer: 'https://pan.xunlei.com/',
        'User-Agent': UA, 'x-client-id': 'ZUBzD9J_XPXfn7f7', 'x-device-id': '5505bd0cab8c9469b98e5891d9fb3e0d',
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (res.status === 404 || res.status === 403) return buildResult(item, normalized, 'bad', false, '链接失效');
    const data = await res.json() as any;
    if (data.share_status === 'OK' || data.share_id || data.share_name || data.file_count > 0) return buildResult(item, normalized, 'ok', false, '链接有效');
    if (containsAny((data.error_description || ''), ['pass_code', '提取码', '密码']) || containsAny((data.error || ''), ['pass_code']))
      return buildResult(item, normalized, 'locked', false, data.error_description || '需要提取码');
    return buildResult(item, normalized, 'bad', false, data.error_description || data.share_status_text || '链接失效');
  } catch {
    return buildResult(item, normalized, 'uncertain', false, '请求失败');
  }
}

async function check115(item: CheckItem, normalized: string): Promise<CheckResult> {
  try {
    const parsed = (() => { try { return new URL(normalized); } catch { return null; } })();
    if (!parsed) return buildResult(item, normalized, 'uncertain', false, '无法解析分享地址');
    const parts = parsed.pathname.replace(/^\/+/, '').split('/');
    const shareCode = parts[parts.length - 1] || '';
    const password = parsed.searchParams.get('password') || item.password || '';
    if (!password) return buildResult(item, normalized, 'locked', false, '115 需要提取码');

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const apiURL = `https://115cdn.com/webapi/share/snap?share_code=${encodeURIComponent(shareCode)}&offset=0&limit=20&receive_code=${encodeURIComponent(password)}&cid=`;
    const res = await fetch(apiURL, {
      headers: {
        Referer: `https://115cdn.com/s/${shareCode}?password=${password}&`,
        'x-requested-with': 'XMLHttpRequest', 'User-Agent': UA,
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    const data = await res.json() as any;
    if (data.state && data.errno === 0 && ((data.data?.list?.length > 0) || data.data?.shareinfo?.snap_id)) {
      return buildResult(item, normalized, 'ok', false, '链接有效');
    }
    if (containsAny(data.error || '', ['密码', '提取码', 'receive_code'])) return buildResult(item, normalized, 'locked', false, data.error || '需要提取码');
    return buildResult(item, normalized, 'bad', false, data.error || '链接失效');
  } catch {
    return buildResult(item, normalized, 'uncertain', false, '请求失败');
  }
}

async function checkTianyi(item: CheckItem, normalized: string): Promise<CheckResult> {
  try {
    const parsed = (() => { try { return new URL(normalized); } catch { return null; } })();
    if (!parsed) return buildResult(item, normalized, 'uncertain', false, '无法解析分享地址');
    let shareCode = parsed.searchParams.get('code') || '';
    if (!shareCode) {
      const pathParts = parsed.pathname.replace(/^\/+/, '').split('/');
      if (pathParts[0] === 't') shareCode = pathParts[1] || '';
    }
    if (!shareCode) return buildResult(item, normalized, 'uncertain', false, '无法解析分享地址');

    const password = item.password || '';
    const shareCodeParam = password ? `${shareCode}（访问码：${password}）` : shareCode;

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 10_000);
    const apiURL = `https://cloud.189.cn/api/open/share/getShareInfoByCodeV2.action?noCache=${Math.random()}&shareCode=${encodeURIComponent(shareCodeParam)}`;
    const res = await fetch(apiURL, { headers: { Referer: normalized, 'sign-type': '1', 'User-Agent': UA }, signal: ctrl.signal });
    clearTimeout(t);
    const text = await res.text();
    if (text.includes('<shareVO>') && (text.includes('<shareId>') || text.includes('<fileName>'))) return buildResult(item, normalized, 'ok', false, '链接有效');
    if (containsAny(text, ['shareinfonotfound', 'sharenotfound', 'filenotfound', 'shareexpired', '不存在', '失效', '取消', '过期']))
      return buildResult(item, normalized, 'bad', false, '链接失效');
    if (containsAny(text, ['accesscode', '访问码', '提取码', '密码'])) return buildResult(item, normalized, 'locked', false, '需要访问码');
    return buildResult(item, normalized, 'uncertain', false, '无法确认链接状态');
  } catch {
    return buildResult(item, normalized, 'uncertain', false, '请求失败');
  }
}

async function checkMobile(item: CheckItem, normalized: string): Promise<CheckResult> {
  // Simplified for Workers — mobile cloud disk requires AES encryption
  return buildResult(item, normalized, 'unsupported', false, '移动云盘检测暂不支持(需加密)');
}

// ─── Dispatch ───

async function runCheck(item: CheckItem, normalized: string): Promise<CheckResult> {
  switch (item.diskType) {
    case 'quark': return checkQuark(item, normalized);
    case 'baidu': return checkBaidu(item, normalized);
    case 'aliyun': case 'alipan': return checkAliyun(item, normalized);
    case 'uc': return checkUC(item, normalized);
    case '123': return check123(item, normalized);
    case 'xunlei': return checkXunlei(item, normalized);
    case '115': return check115(item, normalized);
    case 'tianyi': return checkTianyi(item, normalized);
    case 'mobile': return checkMobile(item, normalized);
    default: return buildResult(item, normalized, 'unsupported', false, '当前平台暂不支持检测');
  }
}

// ─── Public API ───

export async function checkLink(item: CheckItem): Promise<CheckResult> {
  const normalized = normalizeURL(item.url, item.diskType, item.password || '');
  if (!normalized) return buildResult(item, '', 'uncertain', false, '链接格式无效');

  const cacheKey = `${item.diskType}|${normalized}`;

  // Check cache
  {
    const cached = cacheMap.get(cacheKey);
    if (cached) {
      if (Date.now() > cached.expiresAt) {
        cacheMap.delete(cacheKey);
      } else {
        return { ...cached.result, cacheHit: true };
      }
    }
  }

  // Deduplicate in-flight requests
  {
    const inflight = inflightMap.get(cacheKey);
    if (inflight) {
      await inflight.done;
      if (inflight.err) return buildResult(item, normalized, 'uncertain', false, inflight.err);
      return { ...inflight.result!, cacheHit: false };
    }
  }

  // Create inflight entry
  let resolveFn: () => void;
  const donePromise = new Promise<void>(r => { resolveFn = r; });
  const inflightEntry: any = { done: donePromise };
  inflightMap.set(cacheKey, inflightEntry);

  try {
    const result = await runCheck(item, normalized);
    inflightEntry.result = result;
    // Cache successful results
    cacheMap.set(cacheKey, { result, expiresAt: Date.now() + ttlForState(result.state) });
    return { ...result, cacheHit: false };
  } catch (e: any) {
    inflightEntry.err = e?.message || '检测失败';
    return buildResult(item, normalized, 'uncertain', false, '检测失败');
  } finally {
    inflightMap.delete(cacheKey);
    resolveFn!();
  }
}

export async function checkLinks(items: CheckItem[]): Promise<CheckResult[]> {
  return Promise.all(items.map(item => checkLink(item)));
}
