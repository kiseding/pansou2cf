import { register, type AsyncPlugin } from './registry';
import type { SearchResult, Link } from '../types';

const yunsoPlugin: AsyncPlugin = {
  name: 'yunso',
  priority: 3,

  async search(keyword: string): Promise<SearchResult[]> {
    try {
      const url = `https://www.yunso.net/index/user/s?kw=${encodeURIComponent(keyword)}`;
      const res = await fetch(url, {
        headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PanSou/1.0)' },
      });
      if (!res.ok) return [];
      const html = await res.text();
      return parseYunsoHtml(html, keyword);
    } catch { return []; }
  },
};

function parseYunsoHtml(html: string, keyword: string): SearchResult[] {
  const results: SearchResult[] = [];
  // Match search result items — each item contains title, link, password
  const itemRegex = /<div[^>]*class="[^"]*search-item[^"]*"[^>]*>([\s\S]*?)<\/div>\s*<\/div>\s*<\/div>/gi;
  const titleRegex = /<a[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/i;
  const linkRegex = /<a[^>]*href="([^"]*)"[^>]*class="[^"]*link[^"]*"[^>]*>/i;
  const pwdRegex = /密码[：:]\s*([^\s<]+)/i;
  const datetimeRegex = /(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/i;

  let match;
  let idx = 0;
  while ((match = itemRegex.exec(html)) !== null && idx < 50) {
    const block = match[1];
    const titleMatch = block.match(titleRegex);
    const linkMatch = block.match(linkRegex);
    const pwdMatch = block.match(pwdRegex);
    const dateMatch = block.match(datetimeRegex);

    const title = titleMatch?.[1]?.replace(/<[^>]*>/g, '').trim() || keyword;
    const url = linkMatch?.[1] || '';
    const password = pwdMatch?.[1]?.trim() || '';
    const datetime = dateMatch?.[1] || new Date().toISOString();

    if (url) {
      results.push({
        message_id: `yunso_${idx}`,
        unique_id: url,
        channel: 'yunso',
        datetime,
        title,
        content: '',
        links: [{ type: guessType(url), url, password }],
      });
    }
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

register(yunsoPlugin);
