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

  // Match yunso search result cards: div.layui-card[data-qid]
  // Each card contains an a[onclick*="open_sid"] with url/pa/id attributes
  const cardRegex = /<div[^>]*class="[^"]*layui-card[^"]*"[^>]*data-qid="([^"]*)"[^>]*>([\s\S]*?)(?=<div[^>]*class="[^"]*layui-card[^"]*"|<div[^>]*id="yunso-page)/gi;

  // Simpler approach: find all anchors with onclick="open_sid"
  const anchorRegex = /<a[^>]*onclick="open_sid[^"]*"[^>]*url="([^"]*)"[^>]*pa="([^"]*)"[^>]*id="([^"]*)"[^>]*>([\s\S]*?)<\/a>/gi;
  // Also extract from surrounding card: data-qid, .layui-card-body span (file summary), img alt (type), datetime

  let m;
  let idx = 0;
  while ((m = anchorRegex.exec(html)) !== null && idx < 50) {
    const url = htmlDecode(m[1] || '');
    const password = htmlDecode(m[2] || '');
    const fullId = m[3] || '';
    const titleHtml = m[4] || '';
    const title = htmlDecode(titleHtml.replace(/<[^>]*>/g, '').trim());

    if (!url) continue;

    // Try to find title from surrounding context if empty
    const pos = m.index;
    const context = html.substring(Math.max(0, pos - 300), pos);
    const titleMatch = context.match(/layui-card-header[^>]*>([\s\S]*?)<\/div>/i);
    const dateTitle = titleMatch ? htmlDecode(titleMatch[1].replace(/<[^>]*>/g, '').trim()) : '';
    const finalTitle = title || dateTitle || '';

    // Extract datetime from context
    const dateMatch = dateTitle.match(/(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})/);

    // Try to find netdisk type from nearby img
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
