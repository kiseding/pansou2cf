// 小云搜索 (yunso.net) — Ported from Go plugin using goquery selectors
import { register, type AsyncPlugin } from './registry';
import type { SearchResult, Link } from '../types';

function guessType(url: string): string {
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

function htmlDecode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

const yunsoPlugin: AsyncPlugin = {
  name: 'yunso',
  priority: 3,
  async search(keyword: string): Promise<SearchResult[]> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch('https://www.yunso.net/index/user/s?kw=' + encodeURIComponent(keyword), {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html' },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) return [];
      const html = await res.text();
      return parseYunsoHtml(html);
    } catch { return []; }
  },
};

function parseYunsoHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];
  let idx = 0;

  // Find anchors with onclick="open_sid" — extract attributes individually (order-independent)
  const anchorRe = /<a\b[^>]*onclick="open_sid[^"]*"[^>]*>/gi;
  let m;
  while ((m = anchorRe.exec(html)) !== null && idx < 50) {
    const tag = m[0];
    // Extract attributes individually — any order
    const urlMatch = tag.match(/url="([^"]*)"/);
    const paMatch = tag.match(/pa="([^"]*)"/);
    const idMatch = tag.match(/id="([^"]*)"/);

    const url = htmlDecode(urlMatch?.[1] || '');
    const password = htmlDecode(paMatch?.[1] || '');
    const fullId = idMatch?.[1] || '';
    if (!url) continue;

    // Extract inner text from the <a> tag
    const afterTag = html.indexOf(tag, m.index) + tag.length;
    const closeIdx = html.indexOf('</a>', afterTag);
    const innerHTML = closeIdx > afterTag ? html.substring(afterTag, closeIdx) : '';
    const title = htmlDecode(innerHTML.replace(/<[^>]*>/g, '').trim());

    // Find card context (300 chars before the anchor)
    const pos = m.index;
    const context = html.substring(Math.max(0, pos - 400), pos + tag.length + 100);

    // Title from card header (before or after the anchor)
    const headerMatch = context.match(/layui-card-header[^>]*>([\s\S]*?)<\/div>/i);

    // Try context-before (300 chars before) for header
    const beforeCtx = html.substring(Math.max(0, pos - 400), pos);
    const headerBefore = beforeCtx.match(/layui-card-header[^>]*>([\s\S]*?)<\/div>/i);

    const dateTitle = htmlDecode(((headerMatch || headerBefore)?.[1] || '').replace(/<[^>]*>/g, '').trim());
    const finalTitle = title || dateTitle || '';

    // Datetime from card header
    const dateMatch = (dateTitle || context).match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);

    // Netdisk type from img
    const typeMatch = context.match(/\/assets\/xyso\/(\d+)\.png/);
    const typeCodeMap: Record<string, string> = {
      '1': 'baidu', '2': 'quark', '3': 'aliyun', '4': 'xunlei', '5': 'uc', '6': '123', '7': 'tianyi',
    };
    const type = typeCodeMap[typeMatch?.[1] || ''] || guessType(url);

    results.push({
      message_id: 'yunso_' + (fullId || idx),
      unique_id: url,
      channel: 'yunso',
      datetime: dateMatch?.[1] || new Date().toISOString(),
      title: finalTitle || 'yunso_' + idx,
      content: '',
      links: [{ type, url, password }],
    });
    idx++;
  }

  return results;
}

register(yunsoPlugin);
