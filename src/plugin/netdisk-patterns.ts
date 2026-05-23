// Shared netdisk URL patterns — single source of truth, replaces 8 duplicates

export interface NetdiskPattern {
  re: RegExp;
  type: string;
}

export const NETDISK_PATTERNS: NetdiskPattern[] = [
  { re: /https?:\/\/pan\.quark\.cn\/s\/[0-9A-Za-z]+/gi, type: 'quark' },
  { re: /https?:\/\/(?:www\.)?aliyundrive\.com\/s\/[0-9A-Za-z]+/gi, type: 'aliyun' },
  { re: /https?:\/\/www\.alipan\.com\/s\/[0-9A-Za-z]+/gi, type: 'aliyun' },
  { re: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z_-]+/gi, type: 'baidu' },
  { re: /https?:\/\/www\.123pan\.com\/s\/[0-9A-Za-z]+/gi, type: '123' },
  { re: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z]+/gi, type: 'xunlei' },
  { re: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/gi, type: 'uc' },
  { re: /https?:\/\/115\.com\/s\/[0-9A-Za-z]+/gi, type: '115' },
  { re: /https?:\/\/115cdn\.com\/s\/[0-9A-Za-z]+/gi, type: '115' },
  { re: /https?:\/\/cloud\.189\.cn\/t\/[0-9A-Za-z]+/gi, type: 'tianyi' },
  { re: /https?:\/\/caiyun\.139\.com\/w\/i\/[0-9A-Za-z]+/gi, type: 'mobile' },
  { re: /https?:\/\/mypikpak\.com\/s\/[0-9A-Za-z]+/gi, type: 'pikpak' },
];

// Password regex patterns (matching Go: + not {4,8}, colon optional)
export const PWD_PATTERNS = [
  /提取码[:：]?\s*([0-9A-Za-z]+)/gi,
  /密码[:：]?\s*([0-9A-Za-z]+)/gi,
  /pwd\s*[=:：]\s*([0-9A-Za-z]+)/gi,
  /访问码[:：]?\s*([0-9A-Za-z]+)/gi,
  /code\s*[=:：]\s*([0-9A-Za-z]+)/gi,
];

export function extractPassword(text: string, url?: string): string {
  for (const re of PWD_PATTERNS) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) return m[1];
  }
  if (url) {
    try {
      const u = new URL(url);
      for (const k of ['pwd', 'pass', 'password', 'code']) {
        const v = u.searchParams.get(k);
        if (v) return v;
      }
    } catch {}
  }
  return '';
}

export function guessType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('pan.quark') || u.includes('drive-pc.quark')) return 'quark';
  if (u.includes('pan.baidu')) return 'baidu';
  if (u.includes('aliyundrive') || u.includes('alipan')) return 'aliyun';
  if (u.includes('115.com') || u.includes('115cdn')) return '115';
  if (u.includes('pan.xunlei')) return 'xunlei';
  if (u.includes('drive.uc')) return 'uc';
  if (u.includes('123pan') || u.includes('123.cn')) return '123';
  if (u.includes('cloud.189.cn')) return 'tianyi';
  if (u.includes('yun.139') || u.includes('caiyun.139')) return 'mobile';
  return 'unknown';
}

export function extractLinksFromText(text: string): Array<{ url: string; password: string; type: string }> {
  const links: Array<{ url: string; password: string; type: string }> = [];
  const seen = new Set<string>();
  const decoded = text.replace(/&amp;/g, '&');

  for (const { re, type } of NETDISK_PATTERNS) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(decoded)) !== null) {
      const url = m[0];
      if (seen.has(url)) continue;
      seen.add(url);
      const ctx = decoded.substring(Math.max(0, m.index - 80), m.index + m[0].length + 80);
      links.push({ url, password: extractPassword(ctx), type });
    }
  }
  return links;
}
