// 阿鹿盘 (alupan.net) — Ported from Go plugin using article.excerpt selectors
import { register, type AsyncPlugin } from './registry';
import type { SearchResult, Link } from '../types';

function guessType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('quark')) return 'quark';
  if (u.includes('baidu')) return 'baidu';
  if (u.includes('alipan') || u.includes('aliyundrive')) return 'aliyun';
  if (u.includes('115.com')) return '115';
  if (u.includes('xunlei')) return 'xunlei';
  if (u.includes('uc.cn') || u.includes('drive.uc')) return 'uc';
  if (u.includes('123pan')) return '123';
  return 'unknown';
}

function htmlDecode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'");
}

// Password patterns from original Go plugin
const pwdPatterns = [/提取码[:：]?\s*([0-9A-Za-z]{4,8})/i, /密码[:：]?\s*([0-9A-Za-z]{4,8})/i, /pwd\s*[=:：]\s*([0-9A-Za-z]{4,8})/i, /code\s*[=:：]\s*([0-9A-Za-z]{4,8})/i];

function extractPassword(text: string): string {
  for (const p of pwdPatterns) {
    const m = text.match(p);
    if (m) return m[1];
  }
  return '';
}

// Link patterns — specific to each netdisk type
const linkPatterns: Array<{ regex: RegExp; type: string }> = [
  { regex: /https?:\/\/pan\.quark\.cn\/s\/[0-9A-Za-z]+/g, type: 'quark' },
  { regex: /https?:\/\/www\.aliyundrive\.com\/s\/[0-9A-Za-z]+/g, type: 'aliyun' },
  { regex: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z_-]+/g, type: 'baidu' },
  { regex: /https?:\/\/www\.123pan\.com\/s\/[0-9A-Za-z]+/g, type: '123' },
  { regex: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z]+/g, type: 'xunlei' },
  { regex: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/g, type: 'uc' },
  { regex: /https?:\/\/115\.com\/s\/[0-9A-Za-z]+/g, type: '115' },
];

const alupanPlugin: AsyncPlugin = {
  name: 'alupan',
  priority: 5,
  async search(keyword: string): Promise<SearchResult[]> {
    try {
      const ctrl = new AbortController();
      const t = setTimeout(() => ctrl.abort(), 8000);
      const res = await fetch('https://www.alupan.net/search?keyword=' + encodeURIComponent(keyword), {
        headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36' },
        signal: ctrl.signal,
      });
      clearTimeout(t);
      if (!res.ok) return [];
      const html = await res.text();
      return parseAlupanHtml(html);
    } catch { return []; }
  },
};

function parseAlupanHtml(html: string): SearchResult[] {
  const results: SearchResult[] = [];

  // Match article.excerpt blocks — each is a search result
  const articleRegex = /<article[^>]*class="[^"]*excerpt[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  let m;
  let idx = 0;

  while ((m = articleRegex.exec(html)) !== null && idx < 30) {
    const block = m[1];

    // Extract title from header h2 a
    const titleMatch = block.match(/<h2[^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    const detailUrl = titleMatch?.[1] || '';
    const title = titleMatch?.[2] ? htmlDecode(titleMatch[2].replace(/<[^>]*>/g, '').trim()) : '';

    // Extract note/content
    const noteMatch = block.match(/<div[^>]*class="[^"]*note[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    const note = noteMatch ? htmlDecode(noteMatch[1].replace(/<[^>]*>/g, '').trim()) : '';

    // Find links using patterns
    const links: Link[] = [];
    const seen = new Set<string>();
    for (const pat of linkPatterns) {
      pat.regex.lastIndex = 0;
      let lm;
      while ((lm = pat.regex.exec(block)) !== null) {
        const url = lm[0];
        if (!seen.has(url)) {
          seen.add(url);
          links.push({ type: pat.type, url, password: '' });
        }
      }
    }

    // Extract passwords from the block text
    const textContent = block.replace(/<[^>]*>/g, ' ');
    const password = extractPassword(textContent);

    // If we found links, try to enhance with detail info
    let finalTitle = title;
    if (!finalTitle) {
      // Try extracting from surrounding text
      const textMatch = block.match(/<a[^>]*>([\s\S]{4,100}?)<\/a>/i);
      finalTitle = textMatch ? htmlDecode(textMatch[1].replace(/<[^>]*>/g, '').trim()) : '';
    }

    if (links.length > 0 && finalTitle) {
      for (const l of links) {
        if (password) l.password = password;
      }
      results.push({
        message_id: 'alupan_' + idx,
        unique_id: links[0]?.url || 'alupan_' + idx,
        channel: 'alupan',
        datetime: new Date().toISOString(),
        title: finalTitle,
        content: note,
        links,
      });
      idx++;
    }
  }

  // If no articles found, fall back to generic link extraction
  if (results.length === 0) {
    return extractLinksGeneric(html, 'alupan');
  }

  return results;
}

function extractLinksGeneric(html: string, source: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  let idx = 0;

  for (const pat of linkPatterns) {
    pat.regex.lastIndex = 0;
    let m;
    while ((m = pat.regex.exec(html)) !== null && idx < 30) {
      const url = m[0];
      if (!seen.has(url)) {
        seen.add(url);
        const context = html.substring(Math.max(0, m.index - 200), m.index + m[0].length + 200);
        const password = extractPassword(context);
        results.push({
          message_id: source + '_' + idx, unique_id: url,
          channel: source, datetime: new Date().toISOString(),
          title: source + '_' + idx, content: '',
          links: [{ type: pat.type, url, password }],
        });
        idx++;
      }
    }
  }
  return results;
}

register(alupanPlugin);
