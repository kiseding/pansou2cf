// Generic config-driven plugin engine with multi-strategy parsing
import type { SearchResult, Link } from '../types';

export interface PluginConfig {
  name: string;
  priority: number;
  searchUrl: string;
  /** Optional: 'json' to use JSON API parsing, 'html' for HTML, 'auto' to detect */
  mode?: 'json' | 'html' | 'auto';
  /** Optional: JSON path to results array, e.g. "data.results" or "data.items" */
  jsonResultPath?: string;
  /** Optional: JSON field mappings */
  jsonFields?: {
    title?: string;
    url?: string;
    password?: string;
    datetime?: string;
    content?: string;
  };
}

const linkPatterns: Array<{ re: RegExp; type: string }> = [
  { re: /https?:\/\/pan\.quark\.cn\/s\/[0-9A-Za-z]+/gi, type: 'quark' },
  { re: /https?:\/\/(?:www\.)?aliyundrive\.com\/s\/[0-9A-Za-z]+/gi, type: 'aliyun' },
  { re: /https?:\/\/www\.aliyundrive\.com\/s\/[0-9A-Za-z]+/gi, type: 'aliyun' },
  { re: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z_-]+/gi, type: 'baidu' },
  { re: /https?:\/\/www\.123pan\.com\/s\/[0-9A-Za-z]+/gi, type: '123' },
  { re: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z]+/gi, type: 'xunlei' },
  { re: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/gi, type: 'uc' },
  { re: /https?:\/\/115\.com\/s\/[0-9A-Za-z]+/gi, type: '115' },
  { re: /https?:\/\/115cdn\.com\/s\/[0-9A-Za-z]+/gi, type: '115' },
  { re: /https?:\/\/cloud\.189\.cn\/t\/[0-9A-Za-z]+/gi, type: 'tianyi' },
  { re: /https?:\/\/caiyun\.139\.com\/w\/i\/[0-9A-Za-z]+/gi, type: 'mobile' },
  { re: /https?:\/\/yun\.139\.com\/shareweb\/[^\s"'<>]{10,}/gi, type: 'mobile' },
  { re: /https?:\/\/www\.alipan\.com\/s\/[0-9A-Za-z]+/gi, type: 'aliyun' },
];

const pwdPatterns = [
  /提取码[:：]\s*([0-9A-Za-z]{4,8})/gi,
  /密码[:：]\s*([0-9A-Za-z]{4,8})/gi,
  /pwd\s*[=:：]\s*([0-9A-Za-z]{4,8})/gi,
  /访问码[:：]\s*([0-9A-Za-z]{4,8})/gi,
  /code\s*[=:：]\s*([0-9A-Za-z]{4,8})/gi,
];

function htmlDecode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ').replace(/&#x27;/g, "'");
}

function extractPassword(text: string): string {
  for (const re of pwdPatterns) {
    re.lastIndex = 0;
    const m = re.exec(text);
    if (m) return m[1];
  }
  return '';
}

function guessType(url: string): string {
  const u = url.toLowerCase();
  if (u.includes('pan.quark') || u.includes('drive-pc.quark')) return 'quark';
  if (u.includes('pan.baidu')) return 'baidu';
  if (u.includes('aliyundrive') || u.includes('alipan')) return 'aliyun';
  if (u.includes('115.com') || u.includes('115cdn')) return '115';
  if (u.includes('pan.xunlei')) return 'xunlei';
  if (u.includes('drive.uc')) return 'uc';
  if (u.includes('123pan') || u.includes('123.cn')) return '123';
  if (u.includes('cloud.189.cn')) return 'tianyi';
  if (u.includes('yun.139') || u.includes('caiyun.139')) return 'mobile';
  return 'unknown';
}

// URLs on these domains are never netdisk links
const nonNetdiskHosts = /\b(cdn\.|static\.|assets\.|img\.|images\.|css\.|js\.|fonts\.)/i;
const nonNetdiskExts = /\.(?:js|css|png|jpg|jpeg|gif|svg|ico|woff2?|ttf|eot|map|json|xml|webp|avif)(?:[?#].*)?$/i;

function isValidNetdiskUrl(url: string): boolean {
  if (!url) return false;
  try {
    const parsed = new URL(url);
    if (nonNetdiskHosts.test(parsed.hostname)) return false;
    if (nonNetdiskExts.test(parsed.pathname)) return false;
  } catch { return false; }
  return guessType(url) !== 'unknown';
}

function normalizeUrl(u: string): string {
  try {
    const parsed = new URL(u);
    parsed.hash = '';
    parsed.host = parsed.host.toLowerCase();
    return parsed.toString();
  } catch { return u; }
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
    // Auto-detect: find the first array in the response
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
    const linkUrl = resolveValue(item, urlField);
    const rawLinks: Link[] = [];
    if (linkUrl && isValidNetdiskUrl(linkUrl)) {
      rawLinks.push({ type: guessType(linkUrl), url: linkUrl, password: resolveValue(item, pwdField) });
    }
    // Also check for nested links array
    if (item.links && Array.isArray(item.links)) {
      for (const l of item.links) {
        const lurl = typeof l === 'string' ? l : l.url || l.href || '';
        if (lurl && isValidNetdiskUrl(lurl) && !rawLinks.some(ex => ex.url === lurl)) {
          rawLinks.push({ type: guessType(lurl), url: lurl, password: l.password || l.pwd || '' });
        }
      }
    }
    // Filter: only include results that have at least one valid netdisk link
    const links = rawLinks;
    return {
      message_id: cfg.name + '_' + idx,
      unique_id: links[0]?.url || cfg.name + '_' + idx,
      channel: cfg.name,
      datetime: resolveValue(item, dateField) || new Date().toISOString(),
      title: resolveValue(item, titleField) || cfg.name + '_' + idx,
      content: resolveValue(item, contentField) || '',
      links,
    };
  }).filter(r => r.links.length > 0);
}

function resolveValue(obj: any, field: string): string {
  if (!obj) return '';
  if (field.includes('.')) {
    const keys = field.split('.');
    let cur = obj;
    for (const k of keys) { if (cur == null) return ''; cur = cur[k]; }
    return String(cur || '');
  }
  return String(obj[field] || '');
}

function findFirstArray(obj: any): any[] {
  if (Array.isArray(obj)) return obj;
  if (typeof obj !== 'object' || !obj) return [];
  for (const key in obj) {
    if (Array.isArray(obj[key])) return obj[key];
    if (typeof obj[key] === 'object') {
      const found = findFirstArray(obj[key]);
      if (found.length > 0) return found;
    }
  }
  return [];
}

// ── HTML parsing strategies ──

function parseHtmlResponse(html: string, source: string): SearchResult[] {
  // Strategy 1: Try article/excerpt blocks (common in WP/typecho themes)
  const articleResults = extractFromArticleBlocks(html, source);
  if (articleResults.length > 0) return articleResults;

  // Strategy 2: Try list-item blocks
  const listResults = extractFromListItems(html, source);
  if (listResults.length > 0) return listResults;

  // Strategy 3: Try card blocks
  const cardResults = extractFromCards(html, source);
  if (cardResults.length > 0) return cardResults;

  // Strategy 4: Generic link extraction with context grouping
  return extractFromLinks(html, source);
}

// Strategy 1: WordPress/Typecho article.excerpt blocks
function extractFromArticleBlocks(html: string, source: string): SearchResult[] {
  const articleRe = /<article[^>]*class="[^"]*excerpt[^"]*"[^>]*>([\s\S]*?)<\/article>/gi;
  const results: SearchResult[] = [];
  let m;
  let idx = 0;

  while ((m = articleRe.exec(html)) !== null && idx < 50) {
    const block = m[1];
    const titleMatch = block.match(/<h[23][^>]*>\s*<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]*class="[^"]*title[^"]*"[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<a[^>]*href="([^"]*)"[^>]*>([\s\S]*?)<\/a>/i);
    const title = titleMatch ? htmlDecode(titleMatch[2].replace(/<[^>]*>/g, '').trim()) : '';

    const noteMatch = block.match(/<div[^>]*class="[^"]*note[^"]*"[^>]*>([\s\S]*?)<\/div>/i)
      || block.match(/<p[^>]*>([\s\S]*?)<\/p>/i);
    const note = noteMatch ? htmlDecode(noteMatch[1].replace(/<[^>]*>/g, '').trim()) : '';

    const links = extractLinks(block);
    const pwd = extractPassword(block);

    if (links.length > 0 && title) {
      if (pwd) links.forEach(l => l.password = l.password || pwd);
      results.push({
        message_id: source + '_' + idx, unique_id: links[0]?.url || source + '_' + idx,
        channel: source, datetime: extractDate(block),
        title, content: note, links,
      });
      idx++;
    }
  }
  return results;
}

// Strategy 2: Ul/li list items (common in search results)
function extractFromListItems(html: string, source: string): SearchResult[] {
  const liRe = /<li[^>]*>([\s\S]*?)<\/li>/gi;
  const groups: Array<{ title: string; links: Link[]; datetime: string; content: string }> = [];
  let m;

  while ((m = liRe.exec(html)) !== null && groups.length < 50) {
    const block = m[1];
    const links = extractLinks(block);
    if (links.length === 0) continue;

    const aMatch = block.match(/<a[^>]*href="[^"]*"[^>]*>([\s\S]*?)<\/a>/i);
    const title = aMatch ? htmlDecode(aMatch[1].replace(/<[^>]*>/g, '').trim()) : '';
    const pwd = extractPassword(block);
    if (pwd) links.forEach(l => l.password = l.password || pwd);

    groups.push({
      title: title || source,
      links,
      datetime: extractDate(block),
      content: htmlDecode(block.replace(/<[^>]*>/g, ' ').trim()),
    });
  }

  if (groups.length === 0) return [];

  return groups.map((g, idx) => ({
    message_id: source + '_' + idx,
    unique_id: g.links[0]?.url || source + '_' + idx,
    channel: source,
    datetime: g.datetime,
    title: g.title || source + '_' + idx,
    content: g.content,
    links: g.links,
  }));
}

// Strategy 3: Card-based layouts (div.card, .result-item, etc.)
function extractFromCards(html: string, source: string): SearchResult[] {
  const cardRe = /<(?:div|section|a)[^>]*(?:class|id)="[^"]*(?:card|result|search-item|post-item|entry)[^"]*"[^>]*>([\s\S]*?)(?=<(?:div|section|a)[^>]*(?:class|id)="[^"]*(?:card|result|search-item|post-item|entry)|$)/gi;
  const results: SearchResult[] = [];
  let m;
  let idx = 0;

  while ((m = cardRe.exec(html)) !== null && idx < 50) {
    const block = m[1] || m[0];
    const links = extractLinks(block);
    if (links.length === 0) continue;

    const titleMatch = block.match(/<h[234][^>]*>([\s\S]*?)<\/h[234]>/i)
      || block.match(/<a[^>]*class="[^"]*title[^"]*"[^>]*>([\s\S]*?)<\/a>/i)
      || block.match(/<strong[^>]*>([\s\S]*?)<\/strong>/i);
    const title = titleMatch ? htmlDecode(titleMatch[1].replace(/<[^>]*>/g, '').trim()) : '';
    const pwd = extractPassword(block);
    if (pwd) links.forEach(l => l.password = l.password || pwd);

    if (title || links.length > 0) {
      results.push({
        message_id: source + '_' + idx, unique_id: links[0]?.url || source + '_' + idx,
        channel: source, datetime: extractDate(block),
        title: title || source + '_' + idx, content: '',
        links,
      });
      idx++;
    }
  }
  return results;
}

// Strategy 4: Generic link extraction with proximity grouping
function extractFromLinks(html: string, source: string): SearchResult[] {
  const allLinks: Array<{ url: string; type: string; pos: number }> = [];
  const seenUrls = new Set<string>();

  for (const { re, type } of linkPatterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(html)) !== null) {
      const url = htmlDecode(m[0]);
      const normalized = normalizeUrl(url);
      if (!seenUrls.has(normalized)) {
        seenUrls.add(normalized);
        allLinks.push({ url, type, pos: m.index });
      }
    }
  }

  if (allLinks.length === 0) return [];

  // Group links by proximity
  const groups: Array<{ links: Link[]; context: string }> = [];
  let currentLinks: Link[] = [];
  let lastPos = -1;

  for (const link of allLinks) {
    if (lastPos >= 0 && link.pos - lastPos > 2500) {
      if (currentLinks.length > 0) {
        const contextStart = Math.max(0, allLinks[allLinks.indexOf(link) - currentLinks.length]?.pos ?? 0 - 500);
        const contextEnd = Math.min(html.length, link.pos + 500);
        groups.push({ links: [...currentLinks], context: htmlDecode(html.substring(contextStart, contextEnd).replace(/<[^>]*>/g, ' ')) });
      }
      currentLinks = [];
    }
    currentLinks.push({ type: link.type, url: link.url, password: '' });
    lastPos = link.pos;
  }
  if (currentLinks.length > 0) {
    const allPos = allLinks.map(l => l.pos);
    const contextEnd = Math.min(html.length, Math.max(...allPos) + 500);
    groups.push({ links: currentLinks, context: htmlDecode(html.substring(0, contextEnd).replace(/<[^>]*>/g, ' ')) });
  }

  // Build results from groups
  return groups.slice(0, 50).map((group, idx) => {
    const pwd = extractPassword(group.context);
    if (pwd) group.links.forEach(l => l.password = l.password || pwd);

    // Try to extract title from context
    const text = group.context;
    const titleMatch = text.match(/(.{4,80}?)(?:quark|baidu|阿里|夸克|百度|迅雷|aliyun|pan\.)/i);
    const title = titleMatch ? titleMatch[1].replace(/[【】\[\]\(\)（）\/\\,:：，。\.、\s]+/g, ' ').trim() : '';

    return {
      message_id: source + '_' + idx,
      unique_id: group.links[0]?.url || source + '_' + idx,
      channel: source,
      datetime: new Date().toISOString(),
      title: title || source + '_' + idx,
      content: '',
      links: group.links,
    };
  });
}

// ── Helpers ──

function extractLinks(text: string): Link[] {
  const links: Link[] = [];
  const seen = new Set<string>();
  for (const { re, type } of linkPatterns) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(text)) !== null) {
      const url = htmlDecode(m[0]);
      const norm = normalizeUrl(url);
      if (!seen.has(norm)) {
        seen.add(norm);
        links.push({ type, url, password: '' });
      }
    }
  }
  return links;
}

function extractDate(text: string): string {
  const re = /(\d{4}[-/]\d{1,2}[-/]\d{1,2}[T\s]\d{2}:\d{2}(?::\d{2})?)/;
  const m = text.match(re);
  if (m) return m[1].replace(/\//g, '-');
  // Chinese date format
  const cnRe = /(\d{4}年\d{1,2}月\d{1,2}日)/;
  const cnM = text.match(cnRe);
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

    // Extract the search source domain for same-origin filtering
    let sourceHost = '';
    try { sourceHost = new URL(config.searchUrl).hostname; } catch {}

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/124.0 Safari/537.36',
        'Accept': 'text/html,application/json,*/*',
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return [];

    const ct = res.headers.get('content-type') || '';

    if (mode === 'json' || (mode === 'auto' && ct.includes('json'))) {
      try {
        const data = await res.json();
        return parseJsonResponse(data, config).filter(r => filterSameOrigin(r, sourceHost));
      } catch { /* fall through */ }
    }

    const html = await res.text();

    // Even in "auto" or "html" mode, try JSON parsing on the text
    if (mode === 'auto' || 'json') {
      try {
        const data = JSON.parse(html);
        if (data && typeof data === 'object') {
          return parseJsonResponse(data, config).filter(r => filterSameOrigin(r, sourceHost));
        }
      } catch { /* not JSON */ }
    }

    return parseHtmlResponse(html, config.name).filter(r => filterSameOrigin(r, sourceHost));
  } catch {
    return [];
  }
}

// Remove results whose links are on the same domain as the search source
function filterSameOrigin(r: { links: Link[] }, sourceHost: string): boolean {
  if (!sourceHost) return true;
  for (const link of r.links) {
    try {
      const u = new URL(link.url);
      if (u.hostname === sourceHost) return false;
    } catch {}
  }
  return true;
}
