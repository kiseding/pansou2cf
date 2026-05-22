import { register, type AsyncPlugin } from './registry';
import type { SearchResult, Link } from '../types';

const pansearchPlugin: AsyncPlugin = {
  name: 'pansearch',
  priority: 1,

  async search(keyword: string): Promise<SearchResult[]> {
    try {
      const url = `https://pansearch.vip/search?keyword=${encodeURIComponent(keyword)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0', 'Accept': 'application/json' },
      });
      if (!res.ok) return [];
      const data = await res.json() as any;
      const items = data?.data || data?.results || [];
      if (!Array.isArray(items)) return [];

      return items.slice(0, 50).map((item: any, idx: number) => {
        const links: Link[] = [];
        if (item.url) links.push({ type: guessType(item.url), url: item.url, password: item.password || '' });
        if (item.links && Array.isArray(item.links)) {
          for (const l of item.links) {
            links.push({ type: l.type || guessType(l.url || l), url: l.url || l, password: l.password || '' });
          }
        }
        return {
          message_id: `pansearch_${idx}`,
          unique_id: `pansearch_${item.url || item.id || idx}`,
          channel: 'pansearch',
          datetime: new Date().toISOString(),
          title: item.title || item.name || keyword,
          content: item.content || item.description || '',
          links,
        };
      });
    } catch { return []; }
  },
};

function guessType(url: string): string {
  if (!url) return 'unknown';
  const u = url.toLowerCase();
  if (u.includes('quark') || u.includes('pan.quark')) return 'quark';
  if (u.includes('baidu') || u.includes('pan.baidu')) return 'baidu';
  if (u.includes('alipan') || u.includes('aliyundrive')) return 'alipan';
  if (u.includes('115.com') || u.includes('115')) return '115';
  if (u.includes('xunlei') || u.includes('xl')) return 'xunlei';
  if (u.includes('uc.cn') || u.includes('drive.uc')) return 'uc';
  if (u.includes('123pan') || u.includes('123')) return '123';
  return 'unknown';
}

register(pansearchPlugin);
