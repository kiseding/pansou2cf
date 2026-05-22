import { register, type AsyncPlugin } from './registry';
import type { SearchResult, Link } from '../types';

const yunsouPlugin: AsyncPlugin = {
  name: 'yunsou',
  priority: 3,
  async search(keyword: string): Promise<SearchResult[]> {
    try {
      const url = `https://www.yunsou.com/s?q=${encodeURIComponent(keyword)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0' },
      });
      if (!res.ok) return [];
      const html = await res.text();
      return extractFromHtml(html, 'yunsou', keyword);
    } catch { return []; }
  },
};

function extractFromHtml(html: string, source: string, keyword: string): SearchResult[] {
  const results: SearchResult[] = [];
  const linkRegex = /(https?:\/\/[^\s"'<>]+)/g;
  const pwdRegex = /(?:密码|提取码|pwd|password)[：:]\s*([a-zA-Z0-9]{1,10})/gi;
  const seenUrls = new Set<string>();
  let match; let idx = 0;
  while ((match = linkRegex.exec(html)) !== null && idx < 30) {
    const url = match[1];
    if (seenUrls.has(url) || url.length > 500) continue;
    seenUrls.add(url);
    const type = guessType(url);
    if (type === 'unknown') continue;
    results.push({
      message_id: `${source}_${idx}`, unique_id: url,
      channel: source, datetime: new Date().toISOString(),
      title: `${keyword} - ${type}`, content: '',
      links: [{ type, url, password: '' }],
    });
    idx++;
  }
  return results;
}
function guessType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('quark')) return 'quark';
  if (u.includes('baidu')) return 'baidu';
  if (u.includes('alipan') || u.includes('aliyundrive')) return 'alipan';
  if (u.includes('115.com')) return '115';
  if (u.includes('xunlei')) return 'xunlei';
  if (u.includes('uc.cn')) return 'uc';
  if (u.includes('123pan')) return '123';
  return 'unknown';
}
register(yunsouPlugin);
