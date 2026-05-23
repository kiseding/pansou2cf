// Generic config-driven plugin engine
import type { SearchResult, Link } from '../types';

const linkRegexes: Array<{re: RegExp; type: string}> = [
  {re: /https?:\/\/pan\.quark\.cn\/s\/[0-9A-Za-z]+/gi, type: 'quark'},
  {re: /https?:\/\/(?:www\.)?aliyundrive\.com\/s\/[0-9A-Za-z]+/gi, type: 'aliyun'},
  {re: /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z_-]+/gi, type: 'baidu'},
  {re: /https?:\/\/(?:www\.)?123pan\.com\/s\/[0-9A-Za-z]+/gi, type: '123'},
  {re: /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z]+/gi, type: 'xunlei'},
  {re: /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/gi, type: 'uc'},
  {re: /https?:\/\/115\.com\/s\/[0-9A-Za-z]+/gi, type: '115'},
];

const pwdRegexes = [
  /提取码[:：]\s*([0-9A-Za-z]{4,8})/gi,
  /密码[:：]\s*([0-9A-Za-z]{4,8})/gi,
  /pwd\s*[=:：]\s*([0-9A-Za-z]{4,8})/gi,
  /code\s*[=:：]\s*([0-9A-Za-z]{4,8})/gi,
];

function htmlDecode(s: string): string {
  return s.replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&#39;/g, "'").replace(/&nbsp;/g, ' ');
}

export interface PluginConfig {
  name: string;
  priority: number;
  searchUrl: string;
}

export async function configSearch(config: PluginConfig, keyword: string): Promise<SearchResult[]> {
  try {
    const url = config.searchUrl.replace(/\{keyword\}/g, encodeURIComponent(keyword));
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0 (compatible; PanSou/2.0)' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const html = await res.text();
    return extractResults(html, config.name);
  } catch { return []; }
}

function extractResults(html: string, source: string): SearchResult[] {
  const results: SearchResult[] = [];
  const seen = new Set<string>();
  let idx = 0;

  // Step 1: Find all known netdisk links
  const allLinks: Array<{url: string; type: string; context: string}> = [];
  for (const {re, type} of linkRegexes) {
    re.lastIndex = 0;
    let m;
    while ((m = re.exec(html)) !== null) {
      const url = htmlDecode(m[0]);
      if (!seen.has(url)) {
        seen.add(url);
        // Get surrounding context (200 chars before and after)
        const start = Math.max(0, m.index - 300);
        const end = Math.min(html.length, m.index + m[0].length + 300);
        const context = htmlDecode(html.substring(start, end).replace(/<[^>]*>/g, ' '));
        allLinks.push({url, type, context});
      }
    }
  }

  if (allLinks.length === 0) return [];

  // Step 2: Try to group links by proximity (same page section = same resource)
  const groups: Array<{links: Link[]; title: string; context: string}> = [];
  let currentGroup: typeof allLinks = [];
  let lastPos = -1;

  for (const link of allLinks) {
    const pos = html.indexOf(link.url);
    if (lastPos >= 0 && pos - lastPos > 2000) {
      // New group
      if (currentGroup.length > 0) groups.push(buildGroup(currentGroup, html));
      currentGroup = [];
    }
    currentGroup.push(link);
    lastPos = pos;
  }
  if (currentGroup.length > 0) groups.push(buildGroup(currentGroup, html));

  // Step 3: Build results from groups
  for (const group of groups) {
    if (idx >= 50) break;
    // Extract password from context
    let password = '';
    for (const pwdRe of pwdRegexes) {
      pwdRe.lastIndex = 0;
      const pm = pwdRe.exec(group.context);
      if (pm) { password = pm[1]; break; }
    }

    // Set password on all links
    for (const l of group.links) {
      if (password && !l.password) l.password = password;
    }

    results.push({
      message_id: source + '_' + idx,
      unique_id: group.links[0]?.url || source + '_' + idx,
      channel: source,
      datetime: new Date().toISOString(),
      title: group.title || (group.links[0]?.type || '') + '_' + idx,
      content: '',
      links: group.links,
    });
    idx++;
  }

  return results;
}

function buildGroup(links: Array<{url: string; type: string; context: string}>, html: string) {
  const result: {links: Link[]; title: string; context: string} = {
    links: links.map(l => ({type: l.type, url: l.url, password: ''})),
    title: '',
    context: links.map(l => l.context).join(' '),
  };

  // Try to find title near the links
  for (const link of links) {
    const pos = html.indexOf(link.url);
    if (pos < 0) continue;
    // Look for nearby text that could be a title (between tags)
    const before = html.substring(Math.max(0, pos - 500), pos);
    const titleMatch = before.match(/<a[^>]*>([\s\S]{4,100}?)<\/a>/);
    if (titleMatch) {
      result.title = htmlDecode(titleMatch[1].replace(/<[^>]*>/g, '').trim());
      break;
    }
    // Try h2/h3 tags
    const headingMatch = before.match(/<h[23][^>]*>([\s\S]{4,100}?)<\/h[23]>/i);
    if (headingMatch) {
      result.title = htmlDecode(headingMatch[1].replace(/<[^>]*>/g, '').trim());
      break;
    }
  }

  return result;
}
