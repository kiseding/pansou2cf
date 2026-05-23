// Generic config-driven plugin engine with multi-strategy parsing
import type { SearchResult, Link } from '../types';
import { NETDISK_PATTERNS, extractPassword, guessType, extractLinksFromText } from './netdisk-patterns';

export interface PluginConfig {
  name: string;
  priority: number;
  searchUrl: string;
  mode?: 'json' | 'html' | 'auto';
  jsonResultPath?: string;
  jsonFields?: { title?: string; url?: string; password?: string; datetime?: string; content?: string };
  // HTML strategy hints
  selectors?: { item?: string; title?: string; link?: string; date?: string };
}

function htmlDecode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'");
}

// ── JSON API parsing ──

function parseJsonResponse(data: any, cfg: PluginConfig): SearchResult[] {
  const path = cfg.jsonResultPath || '';
  let items: any[];
  if (path) {
    const keys = path.split('.');
    let cur = data;
    for (const k of keys) { if (cur == null) break; cur = cur[k]; }
    items = Array.isArray(cur) ? cur : [];
  } else {
    items = findFirstArray(data);
  }
  if (!items || !items.length) return [];

  const fm = cfg.jsonFields || {};
  const titleField = fm.title || 'title';
  const urlField = fm.url || 'url';
  const pwdField = fm.password || 'password';
  const dateField = fm.datetime || 'datetime';
  const contentField = fm.content || 'content';

  return items.slice(0, 50).map((item: any, idx: number) => {
    const rawLinks: Link[] = [];
    const url = resolveValue(item, urlField);
    if (url && guessType(url) !== 'unknown') {
      rawLinks.push({ type: guessType(url), url, password: resolveValue(item, pwdField) });
    }
    // Check nested links array
    if (item.links && Array.isArray(item.links)) {
      for (const l of item.links) {
        const u = typeof l === 'string' ? l : l.url || l.href || '';
        if (u && guessType(u) !== 'unknown' && !rawLinks.some(x => x.url === u)) {
          rawLinks.push({ type: guessType(u), url: u, password: l.password || l.pwd || '' });
        }
      }
    }
    // If no direct netdisk links, extract from content
    if (rawLinks.length === 0) {
      const text = resolveValue(item, contentField) || resolveValue(item, 'text_raw') || resolveValue(item, 'text') || JSON.stringify(item);
      rawLinks.push(...extractLinksFromText(text).map(l => ({ type: l.type, url: l.url, password: l.password })));
    }
    return {
      message_id: cfg.name + '_' + idx,
      unique_id: rawLinks[0]?.url || cfg.name + '_' + idx,
      channel: cfg.name,
      datetime: resolveValue(item, dateField) || new Date().toISOString(),
      title: resolveValue(item, titleField) || cfg.name + '_' + idx,
      content: resolveValue(item, contentField) || '',
      links: rawLinks,
    };
  }).filter(r => r.links.length > 0);
}

function resolveValue(obj: any, field: string): string {
  if (!obj) return '';
  const keys = field.split('.');
  let cur = obj;
  for (const k of keys) { if (cur == null) return ''; cur = cur[k]; }
  return String(cur || '');
}

function findFirstArray(obj: any): any[] {
  if (Array.isArray(obj)) return obj;
  if (typeof obj !== 'object' || !obj) return [];
  for (const key in obj) {
    if (Array.isArray(obj[key]) && obj[key].length > 0) return obj[key];
    if (typeof obj[key] === 'object') {
      const found = findFirstArray(obj[key]);
      if (found.length > 0) return found;
    }
  }
  return [];
}

// ── Multi-strategy HTML parsing ──

function parseHtmlResponse(html: string, source: string, selectors?: PluginConfig['selectors']): SearchResult[] {
  // Strategy 1: VOD/CMS pattern (index.php/vod/search) — extract <a> with specific patterns
  const vod = extractVODPattern(html, source);
  if (vod.length >= 3) return vod;

  // Strategy 2: WordPress/Archive listing
  const wp = extractWordPressPattern(html, source);
  if (wp.length >= 3) return wp;

  // Strategy 3: Article/excerpt blocks
  const art = extractFromArticles(html, source);
  if (art.length >= 3) return art;

  // Strategy 4: Custom selectors
  if (selectors?.item) {
    const sel = extractWithSelectors(html, source, selectors);
    if (sel.length >= 3) return sel;
  }

  // Strategy 5: Generic: extract all netdisk links with context
  return extractGeneric(html, source);
}

// Strategy 1: VOD/CMS (vod/search/wd pattern, common in 苹果CMS etc)
function extractVODPattern(html: string, source: string): SearchResult[] {
  const results: SearchResult[] = [];
  // Match <li> or <div> items containing <a> with title + vod/detail links
  const itemRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  const seen = new Set<string>();
  let idx = 0;
  let m;

  while ((m = itemRe.exec(html)) !== null && idx < 50) {
    const block = m[1];
    // Extract title from <a> with title attr or inner text
    const aMatch = block.match(/<a[^>]*title="([^"]*)"[^>]*>/i) || block.match(/<a[^>]*>([\s\S]*?)<\/a>/i);
    const title = aMatch ? htmlDecode((aMatch[1] || '').replace(/<[^>]*>/g, '').trim()) : '';

    const links = extractLinksFromText(block);
    if (links.length > 0) {
      for (const l of links) { if (seen.has(l.url)) continue; seen.add(l.url); }
      const pwd = extractPassword(block);
      if (pwd) links.forEach(l => l.password = l.password || pwd);
      results.push({
        message_id: source + '_' + idx, unique_id: links[0]?.url || source + '_' + idx,
        channel: source, datetime: new Date().toISOString(), title: title || source + '_' + idx,
        content: htmlDecode(block.replace(/<[^>]*>/g, ' ').trim().slice(0, 200)), links,
      });
      idx++;
    }
  }
  return results;
}

// Strategy 2: WordPress/Archive (article, post, entry classes)
function extractWordPressPattern(html: string, source: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  let idx = 0;

  // Match article/post blocks
  const blockRe = /<(?:article|div)[^>]*(?:class|id)="[^"]*(?:post|entry|article|excerpt|blog)[^"]*"[^>]*>([\s\S]*?)(?=<(?:article|div)[^>]*(?:class|id)="[^"]*(?:post|entry|article|excerpt|blog)|$)/gi;
  let m;
  while ((m = blockRe.exec(html)) !== null && idx < 30) {
    const block = m[1] || m[0];
    const links = extractLinksFromText(block);
    if (links.length === 0) continue;

    const titleMatch = block.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i) || block.match(/<a[^>]*>([\s\S]{4,100}?)<\/a>/i);
    const title = titleMatch ? htmlDecode(titleMatch[1].replace(/<[^>]*>/g, '').trim()) : '';

    for (const l of links) { if (seen.has(l.url)) continue; seen.add(l.url); }
    const pwd = extractPassword(block);
    if (pwd) links.forEach(l => l.password = l.password || pwd);

    results.push({
      message_id: source + '_' + idx, unique_id: links[0]?.url || source + '_' + idx,
      channel: source, datetime: extractDate(block), title: title || source + '_' + idx,
      content: htmlDecode(block.replace(/<[^>]*>/g, ' ').trim().slice(0, 200)), links,
    });
    idx++;
  }
  return results;
}

// Strategy 3: Article/excerpt blocks (WP themes)
function extractFromArticles(html: string, source: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  let idx = 0;
  const re = /<article[^>]*>([\s\S]*?)<\/article>/gi;
  let m;
  while ((m = re.exec(html)) !== null && idx < 30) {
    const block = m[1];
    const links = extractLinksFromText(block);
    if (links.length === 0) continue;

    const titleMatch = block.match(/<h[23][^>]*>\s*<a[^>]*>([\s\S]*?)<\/a>/i) || block.match(/<a[^>]*>([\s\S]{4,100}?)<\/a>/i);
    const title = titleMatch ? htmlDecode(titleMatch[1].replace(/<[^>]*>/g, '').trim()) : '';

    for (const l of links) { if (seen.has(l.url)) continue; seen.add(l.url); }
    const pwd = extractPassword(block);
    if (pwd) links.forEach(l => l.password = l.password || pwd);

    results.push({
      message_id: source + '_' + idx, unique_id: links[0]?.url || source + '_' + idx,
      channel: source, datetime: extractDate(block), title: title || source + '_' + idx,
      content: '', links,
    });
    idx++;
  }
  return results;
}

// Strategy 4: Custom selectors
function extractWithSelectors(html: string, source: string, sels: NonNullable<PluginConfig['selectors']>): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  let idx = 0;
  // Build item regex from selector
  const tag = sels.item?.match(/^(\w+)/)?.[1] || 'div';
  const cls = sels.item?.match(/\.([\w-]+)/)?.[1] || '';
  const itemRe = cls
    ? new RegExp(`<${tag}[^>]*class="[^"]*${cls}[^"]*"[^>]*>([\\s\\S]*?)</${tag}>`, 'gi')
    : new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'gi');
  let m;
  while ((m = itemRe.exec(html)) !== null && idx < 30) {
    const block = m[1];
    const links = extractLinksFromText(block);
    if (links.length === 0) continue;

    let title = '';
    if (sels.title) {
      const tMatch = block.match(new RegExp(sels.title.replace(/\.([\w-]+)/g, '[^"]*$1[^"]*'), 'i'));
      title = tMatch ? htmlDecode(tMatch[1]?.replace(/<[^>]*>/g, '').trim() || '') : '';
    }
    if (!title) {
      const aMatch = block.match(/<a[^>]*>([\s\S]{4,100}?)<\/a>/i);
      title = aMatch ? htmlDecode(aMatch[1].replace(/<[^>]*>/g, '').trim()) : '';
    }

    for (const l of links) { if (seen.has(l.url)) continue; seen.add(l.url); }
    const pwd = extractPassword(block);
    if (pwd) links.forEach(l => l.password = l.password || pwd);

    results.push({
      message_id: source + '_' + idx, unique_id: links[0]?.url || source + '_' + idx,
      channel: source, datetime: extractDate(block), title: title || source + '_' + idx,
      content: '', links,
    });
    idx++;
  }
  return results;
}

// Strategy 5: Generic — all netdisk links in the page
function extractGeneric(html: string, source: string): SearchResult[] {
  const links = extractLinksFromText(html);
  if (links.length === 0) return [];

  const results: SearchResult[] = [];
  const seen = new Set<string>();

  // Group links by proximity in the HTML
  for (const { url, password, type } of links) {
    if (seen.has(url)) continue;
    seen.add(url);
    // Find context around this link for title
    const pos = html.indexOf(url);
    const ctx = pos >= 0 ? htmlDecode(html.substring(Math.max(0, pos - 300), pos).replace(/<[^>]*>/g, ' ')).trim() : '';
    const titleMatch = ctx.match(/(.{4,60}?)$/);
    const title = titleMatch ? titleMatch[1].trim() : source + '_' + results.length;

    results.push({
      message_id: source + '_' + results.length,
      unique_id: url,
      channel: source,
      datetime: new Date().toISOString(),
      title: title || source + '_' + results.length,
      content: '',
      links: [{ type, url, password }],
    });
  }
  return results.slice(0, 30);
}

function extractDate(text: string): string {
  const m = text.match(/(\d{4}[-/]\d{1,2}[-/]\d{1,2}[T\s]\d{2}:\d{2}(?::\d{2})?)/);
  if (m) return m[1].replace(/\//g, '-');
  const cnM = text.match(/(\d{4}年\d{1,2}月\d{1,2}日)/);
  if (cnM) {
    const parts = cnM[1].match(/\d+/g);
    if (parts && parts.length === 3) return `${parts[0]}-${parts[1].padStart(2, '0')}-${parts[2].padStart(2, '0')}`;
  }
  return new Date().toISOString();
}

// ── Main export ──

export async function configSearch(config: PluginConfig, keyword: string): Promise<SearchResult[]> {
  try {
    const url = config.searchUrl.replace(/\{keyword\}/g, encodeURIComponent(keyword));
    const mode = config.mode || 'auto';

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36', 'Accept': 'text/html,application/json,*/*' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return [];

    const text = await res.text();
    const ct = res.headers.get('content-type') || '';

    // JSON mode
    if (mode === 'json' || (mode === 'auto' && ct.includes('json'))) {
      try {
        const data = JSON.parse(text);
        if (data && typeof data === 'object') return parseJsonResponse(data, config);
      } catch {}
      if (mode === 'json') return [];
    }

    // Auto: try JSON parse
    if (mode === 'auto') {
      try {
        const data = JSON.parse(text);
        if (data && typeof data === 'object') return parseJsonResponse(data, config);
      } catch {}
    }

    return parseHtmlResponse(text, config.name, config.selectors);
  } catch {
    return [];
  }
}
