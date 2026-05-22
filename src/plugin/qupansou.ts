import { register, type AsyncPlugin } from './registry';
import type { SearchResult, Link } from '../types';

const qupansouPlugin: AsyncPlugin = {
  name: 'qupansou',
  priority: 5,

  async search(keyword: string): Promise<SearchResult[]> {
    try {
      const urls: Record<string, string> = {
        qupansou: 'https://www.qupansou.com/s?kw=',
        pan666: 'https://pan666.net/search?keyword=',
        haisou: 'https://www.haisou.net/search?q=',
        alupan: 'https://www.alupan.net/search?keyword=',
        panlian: 'https://www.panlian.xyz/search?kw=',
        sousou: 'https://www.sousou.top/search?q=',
        panta: 'https://www.panta.top/search?keyword=',
      };
      const url = urls['qupansou'] + encodeURIComponent(keyword);
      if (!url) return [];
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PanSou/1.0)' },
      });
      if (!res.ok) return [];
      const html = await res.text();
      return extractLinks(html, 'qupansou', keyword);
    } catch { return []; }
  },
};

function extractLinks(html: string, source: string, keyword: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const linkRegex = /https?:\/\/[^\s"'<>]+/g;
  let m; let idx = 0;
  while ((m = linkRegex.exec(html)) !== null && idx < 30) {
    const u = m[0];
    if (seen.has(u) || u.length > 500) continue;
    seen.add(u);
    const type = guessType(u);
    if (type === 'unknown') continue;
    results.push({
      message_id: `${source}_${idx}`, unique_id: u,
      channel: source, datetime: new Date().toISOString(),
      title: `${keyword} - ${type}`, content: '',
      links: [{ type, url: u, password: '' }],
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
register(qupansouPlugin);
