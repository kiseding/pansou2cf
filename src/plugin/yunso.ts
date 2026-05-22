import { register, type AsyncPlugin } from './registry';
import type { SearchResult, Link } from '../types';

const sites: Array<{ name: string; url: string; priority: number }> = [
  { name: 'yunso', url: 'https://www.yunso.net/index/user/s?kw=', priority: 3 },
  { name: 'yunsou', url: 'https://www.yunsou.com/s?q=', priority: 3 },
  { name: 'qupansou', url: 'https://www.qupansou.com/s?kw=', priority: 5 },
  { name: 'pan666', url: 'https://pan666.net/search?keyword=', priority: 5 },
  { name: 'alupan', url: 'https://www.alupan.net/search?keyword=', priority: 5 },
  { name: 'panlian', url: 'https://www.panlian.xyz/search?kw=', priority: 5 },
  { name: 'sousou', url: 'https://www.sousou.top/search?q=', priority: 5 },
  { name: 'panta', url: 'https://www.panta.top/search?keyword=', priority: 5 },
  { name: 'haisou', url: 'https://www.haisou.net/search?q=', priority: 5 },
];

function guessType(url: string): string {
  if (!url) return 'unknown';
  const u = url.toLowerCase();
  if (u.includes('quark')) return 'quark';
  if (u.includes('baidu')) return 'baidu';
  if (u.includes('alipan') || u.includes('aliyundrive')) return 'alipan';
  if (u.includes('115.com')) return '115';
  if (u.includes('xunlei')) return 'xunlei';
  if (u.includes('uc.cn') || u.includes('drive.uc')) return 'uc';
  if (u.includes('123pan')) return '123';
  return 'unknown';
}

function extractFromHtml(html: string, source: string, keyword: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  const urlRegex = /https?:\/\/[^\s"'<>]{10,500}/g;
  let m; let idx = 0;
  while ((m = urlRegex.exec(html)) !== null && idx < 30) {
    const u = m[0].replace(/&amp;/g, '&');
    if (seen.has(u)) continue;
    seen.add(u);
    const type = guessType(u);
    if (type === 'unknown' && u.length < 60) continue;
    results.push({
      message_id: source + '_' + idx, unique_id: u,
      channel: source, datetime: new Date().toISOString(),
      title: keyword + ' - ' + (type !== 'unknown' ? type : ''),
      content: '',
      links: [{ type, url: u, password: '' }],
    });
    idx++;
  }
  return results;
}

// Register each site as an individual plugin
for (const site of sites) {
  const plugin: AsyncPlugin = {
    name: site.name,
    priority: site.priority,
    async search(keyword: string): Promise<SearchResult[]> {
      try {
        const ctrl = new AbortController();
        const t = setTimeout(() => ctrl.abort(), 6000);
        const res = await fetch(site.url + encodeURIComponent(keyword), {
          headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PanSou/2.0)' },
          signal: ctrl.signal,
        });
        clearTimeout(t);
        if (!res.ok) return [];
        const html = await res.text();
        return extractFromHtml(html, site.name, keyword);
      } catch { return []; }
    },
  };
  register(plugin);
}
