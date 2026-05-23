// Pansearch plugin — pansearch.me API JSON parsing
import { register, type AsyncPlugin } from './registry';
import type { SearchResult, Link } from '../types';

const pansearchPlugin: AsyncPlugin = {
  name: 'pansearch',
  priority: 1,

  async search(keyword: string): Promise<SearchResult[]> {
    try {
      // Get buildId from HTML page
      const htmlRes = await fetch('https://www.pansearch.me/search?keyword=' + encodeURIComponent(keyword), {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (!htmlRes.ok) return [];
      const html = await htmlRes.text();

      const buildMatch = html.match(/"buildId":"([^"]+)"/);
      if (!buildMatch) return [];
      const buildId = buildMatch[1];

      // Fetch JSON API
      const apiUrl = 'https://www.pansearch.me/_next/data/' + buildId + '/search.json?keyword=' + encodeURIComponent(keyword);
      const res = await fetch(apiUrl, {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
      });
      if (!res.ok) return [];
      const data = await res.json() as any;

      // Real API structure: pageProps.data.data[]
      const items = data?.pageProps?.data?.data || data?.pageProps?.results || [];
      if (!Array.isArray(items) || items.length === 0) return [];

      return items.slice(0, 50).map((item: any, idx: number) => {
        const content = item.content || '';
        const panType = normalizePanType(item.pan || '');
        const links = parseContentLinks(content, panType);

        // Extract title from content (first line before 描述/链接)
        let title = '';
        const cleanText = content.replace(/<[^>]*>/g, ' ').replace(/&[a-z]+;/g, ' ').replace(/\s+/g, ' ').trim();
        const nameMatch = cleanText.match(/^名称[:：]\s*(.+?)(?:\s*描述[:：]|\s*链接[:：]|$)/);
        if (nameMatch) {
          title = nameMatch[1].trim();
        } else {
          // First non-empty line as title
          const lines = cleanText.split(/[。；\n]/);
          title = lines[0].trim().slice(0, 50);
        }
        // If no title could be extracted, use first netdisk link domain as hint
        if (!title && links.length > 0) {
          title = links[0].type + '_' + idx;
        }

        return {
          message_id: 'ps_' + idx,
          unique_id: 'ps_' + (item.id || idx),
          channel: 'pansearch',
          datetime: item.time || new Date().toISOString(),
          title: title || ('资源_' + idx),
          content: cleanText.slice(0, 200),
          links,
          images: item.image ? [item.image] : [],
        };
      });
    } catch { return []; }
  },
};

// Parse pansearch content HTML to extract links with passwords
function parseContentLinks(content: string, defaultType: string): Link[] {
  const links: Link[] = [];
  const seen = new Set<string>();

  // Find all <a> tags with href attributes
  const anchorRe = /<a\b[^>]*href="([^"]*)"[^>]*>/gi;
  let m;
  while ((m = anchorRe.exec(content)) !== null) {
    const rawUrl = m[1].replace(/&amp;/g, '&');
    if (!rawUrl) continue;

    // Extract password from URL query params (?pwd=, ?password=, etc.)
    let url = rawUrl;
    let password = '';

    try {
      // Try to clean the URL and extract password
      const urlObj = new URL(rawUrl);
      for (const key of ['pwd', 'pass', 'password', 'code', 'accessCode']) {
        const val = urlObj.searchParams.get(key);
        if (val) {
          password = val;
          urlObj.searchParams.delete(key);
          break;
        }
      }
      url = urlObj.toString();
    } catch {
      // Manual extraction from URL string (matching Go's approach)
      const pwdMatch = rawUrl.match(/[?&](?:pwd|pass|password|code)=([^&?#]+)/i);
      if (pwdMatch) {
        password = pwdMatch[1];
        url = rawUrl.replace(/[?&](?:pwd|pass|password|code)=([^&?#]+)/i, '').replace(/[?&]$/, '');
      }
    }

    // Also search for password in surrounding HTML context (Go's approach: ?pwd= in content text)
    if (!password) {
      const ctxStart = Math.max(0, m.index);
      const ctxEnd = Math.min(content.length, m.index + m[0].length + 200);
      const context = content.substring(ctxStart, ctxEnd);
      // Go pattern: find ?pwd= in the raw HTML text
      const ctxPwdMatch = context.match(/\?pwd=([0-9A-Za-z]+)/i);
      if (ctxPwdMatch) password = ctxPwdMatch[1];
    }

    const type = defaultType || guessType(url);
    if (type === 'unknown') continue; // Skip non-netdisk URLs

    if (!seen.has(url)) {
      seen.add(url);
      links.push({ type, url, password });
    }
  }

  // If no links found via <a> tags, search raw content for netdisk URLs
  if (links.length === 0) {
    const netdiskPatterns: Array<{ re: RegExp; type: string }> = [
      { re: /https?:\/\/pan\.quark\.cn\/s\/[0-9A-Za-z]+/g, type: 'quark' },
      { re: /https?:\/\/(?:www\.)?aliyundrive\.com\/s\/[0-9A-Za-z]+/g, type: 'aliyun' },
      { re: /https?:\/\/www\.alipan\.com\/s\/[0-9A-Za-z]+/g, type: 'aliyun' },
      { re: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z_-]+/g, type: 'baidu' },
      { re: /https?:\/\/www\.123pan\.com\/s\/[0-9A-Za-z]+/g, type: '123' },
      { re: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z]+/g, type: 'xunlei' },
      { re: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/g, type: 'uc' },
      { re: /https?:\/\/115\.com\/s\/[0-9A-Za-z]+/g, type: '115' },
      { re: /https?:\/\/cloud\.189\.cn\/t\/[0-9A-Za-z]+/g, type: 'tianyi' },
    ];
    for (const { re, type } of netdiskPatterns) {
      re.lastIndex = 0;
      let nm;
      while ((nm = re.exec(content)) !== null) {
        const rawUrl = nm[0].replace(/&amp;/g, '&');
        let pwd = '';
        // Check if ?pwd= follows in the raw text
        const after = content.substring(nm.index + nm[0].length, nm.index + nm[0].length + 50);
        const pwdMatch = after.match(/^\?pwd=([0-9A-Za-z]+)/);
        if (pwdMatch) pwd = pwdMatch[1];

        if (!seen.has(rawUrl)) {
          seen.add(rawUrl);
          links.push({ type, url: rawUrl, password: pwd });
        }
      }
    }
  }

  return links;
}

function normalizePanType(pan: string): string {
  const m: Record<string, string> = {
    quark: 'quark', baidu: 'baidu', aliyun: 'aliyun', alipan: 'aliyun',
    xunlei: 'xunlei', uc: 'uc', '123': '123', tianyi: 'tianyi', '115': '115',
  };
  return m[pan?.toLowerCase()] || '';
}

function guessType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('pan.quark')) return 'quark';
  if (u.includes('pan.baidu')) return 'baidu';
  if (u.includes('aliyundrive') || u.includes('alipan')) return 'aliyun';
  if (u.includes('pan.xunlei')) return 'xunlei';
  if (u.includes('drive.uc')) return 'uc';
  if (u.includes('123pan') || u.includes('123.cn')) return '123';
  if (u.includes('115.com')) return '115';
  if (u.includes('cloud.189.cn')) return 'tianyi';
  return 'unknown';
}

register(pansearchPlugin);
