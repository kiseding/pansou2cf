import { register, type AsyncPlugin } from './registry';
import type { SearchResult, Link } from '../types';

const pansearchPlugin: AsyncPlugin = {
  name: 'pansearch',
  priority: 1,

  async search(keyword: string): Promise<SearchResult[]> {
    const results: SearchResult[] = [];

    // Try multiple search endpoints
    const tasks = [
      searchPansearchMe(keyword),
      searchGeneric(keyword, 'https://www.pansearch.me/search?keyword=' + encodeURIComponent(keyword) + '&page=1', 'pansearch_me'),
    ];

    const all = await Promise.allSettled(tasks);
    for (const r of all) {
      if (r.status === 'fulfilled') results.push(...r.value);
    }

    return results;
  },
};

async function searchPansearchMe(keyword: string): Promise<SearchResult[]> {
  try {
    // First get the page to extract buildId
    const htmlRes = await fetch('https://www.pansearch.me/search?keyword=' + encodeURIComponent(keyword), {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!htmlRes.ok) return [];
    const html = await htmlRes.text();

    // Extract buildId
    const buildMatch = html.match(/"buildId":"([^"]+)"/);
    if (!buildMatch) return [];
    const buildId = buildMatch[1];

    // Use the API
    const apiUrl = 'https://www.pansearch.me/_next/data/' + buildId + '/search.json?keyword=' + encodeURIComponent(keyword);
    const res = await fetch(apiUrl, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
    });
    if (!res.ok) return [];
    const data = await res.json() as any;

    const items = data?.pageProps?.results || data?.pageProps?.data || [];
    if (!Array.isArray(items)) return [];

    return items.slice(0, 50).map((item: any, idx: number) => {
      const links: Link[] = [];
      if (item.url) {
        links.push({ type: guessType(item.url), url: item.url, password: item.password || '' });
      }
      if (item.links && Array.isArray(item.links)) {
        for (const l of item.links) {
          links.push({ type: guessType(l.url || l), url: l.url || l, password: l.password || '' });
        }
      }
      return {
        message_id: 'ps_' + idx,
        unique_id: item.url || item.id || 'ps_' + idx,
        channel: 'pansearch',
        datetime: item.datetime || item.date || new Date().toISOString(),
        title: item.title || item.name || keyword,
        content: item.content || item.description || '',
        links: links.length > 0 ? links : [{ type: guessType(item.url || ''), url: item.url || '', password: item.password || '' }],
      };
    });
  } catch { return []; }
}

async function searchGeneric(keyword: string, url: string, source: string): Promise<SearchResult[]> {
  try {
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PanSou/2.0)', 'Accept': 'text/html,application/json' },
    });
    if (!res.ok) return [];
    const ct = res.headers.get('content-type') || '';
    const text = await res.text();

    if (ct.includes('json')) {
      try {
        const data = JSON.parse(text);
        const items = data?.results || data?.data || data?.items || data || [];
        const arr = Array.isArray(items) ? items : (items.results || items.data || []);
        return arr.slice(0, 30).map((item: any, i: number) => formatResult(item, source, i));
      } catch { /* fall through to HTML parsing */ }
    }

    // HTML parsing: extract links
    return extractLinks(text, source, keyword);
  } catch { return []; }
}

function extractLinks(html: string, source: string, keyword: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();

  // Find all URLs in the page
  const urlRegex = /https?:\/\/[^\s"'<>]{10,500}/g;
  let m;
  let idx = 0;
  while ((m = urlRegex.exec(html)) !== null && idx < 30) {
    const u = m[0].replace(/&amp;/g, '&');
    if (seen.has(u)) continue;
    seen.add(u);
    const type = guessType(u);
    if (type === 'unknown' && u.length < 50) continue;
    results.push({
      message_id: source + '_' + idx,
      unique_id: u,
      channel: source,
      datetime: new Date().toISOString(),
      title: keyword + ' - ' + (type !== 'unknown' ? type : u.split('/')[2] || ''),
      content: '',
      links: [{ type, url: u, password: '' }],
    });
    idx++;
  }
  return results;
}

function formatResult(item: any, source: string, idx: number): SearchResult {
  return {
    message_id: source + '_' + idx,
    unique_id: item.url || item.id || source + '_' + idx,
    channel: source,
    datetime: item.datetime || item.date || new Date().toISOString(),
    title: item.title || item.name || '',
    content: item.content || item.description || '',
    links: [{
      type: guessType(item.url || ''),
      url: item.url || '',
      password: item.password || '',
    }],
  };
}

function guessType(url: string): string {
  if (!url) return 'unknown';
  const u = url.toLowerCase();
  if (u.includes('pan.quark') || u.includes('quark')) return 'quark';
  if (u.includes('pan.baidu') || u.includes('baidu')) return 'baidu';
  if (u.includes('alipan') || u.includes('aliyundrive')) return 'alipan';
  if (u.includes('115.com')) return '115';
  if (u.includes('xunlei') || u.includes('.xl') || u.includes('thunder')) return 'xunlei';
  if (u.includes('drive.uc') || u.includes('uc.cn')) return 'uc';
  if (u.includes('123pan') || u.includes('123.cn')) return '123';
  return 'unknown';
}

register(pansearchPlugin);
