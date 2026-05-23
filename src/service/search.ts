import { getConfig } from '../config';
import { getFiltered, getByName } from '../plugin/registry';
import type { SearchRequest, SearchResponse, SearchResult, MergedLinks, MergedLink, Link } from '../types';
import { bootPlugins } from '../plugin/boot';
bootPlugins();

// ── Constants ──

const PLUGIN_TIMEOUT_MS = 8000;
const TG_TIMEOUT_MS = 5000;
const OVERALL_TIMEOUT_MS = 20000;
const CACHE_TTL_SECONDS = 600;

const PRIORITY_KEYWORDS = ['合集', '系列', '全', '完', '最新', '附', 'complete'];

// Netdisk link patterns for title extraction
const NETDISK_PATTERNS = [
  /https?:\/\/cloud\.189\.cn\/t\/[0-9A-Za-z]+/g,   // tianyi — must be before generic patterns
  /https?:\/\/pan\.quark\.cn\/s\/[0-9A-Za-z]+/g,
  /https?:\/\/(?:www\.)?aliyundrive\.com\/s\/[0-9A-Za-z]+/g,
  /https?:\/\/www\.alipan\.com\/s\/[0-9A-Za-z]+/g,
  /https?:\/\/pan\.baidu\.com\/s\/[0-9A-Za-z_-]+/g,
  /https?:\/\/www\.123pan\.com\/s\/[0-9A-Za-z]+/g,
  /https?:\/\/pan\.xunlei\.com\/s\/[0-9A-Za-z]+/g,
  /https?:\/\/drive\.uc\.cn\/s\/[0-9A-Za-z]+/g,
  /https?:\/\/115\.com\/s\/[0-9A-Za-z]+/g,
  /https?:\/\/115cdn\.com\/s\/[0-9A-Za-z]+/g,
  /https?:\/\/caiyun\.139\.com\/w\/i\/[0-9A-Za-z]+/g,
];

// Cloud disk names that should NOT be treated as titles (Go: isLinkPrefix)
const CLOUD_DISK_NAMES = new Set([
  '夸克', '夸克网盘', 'quark', '夸克云盘',
  '百度', '百度网盘', 'baidu', '百度云', 'bdwp', 'bdpan',
  '迅雷', '迅雷网盘', 'xunlei', '迅雷云盘',
  '115', '115网盘', '115云盘',
  '123', '123pan', '123网盘', '123云盘',
  '阿里', '阿里云', '阿里云盘', 'aliyun', 'alipan', '阿里网盘',
  '光鸭', '光鸭云盘', '光鸭网盘', 'guangya',
  '天翼', '天翼云', '天翼云盘', 'tianyi', '天翼网盘',
  'uc', 'uc网盘', 'uc云盘',
  '移动', '移动云', '移动云盘', 'caiyun', '彩云',
  'pikpak', 'pikpak网盘',
]);

// ── Cache (Cloudflare Cache API) ──

function cacheKey(kw: string, src: string, plugins?: string[]): string {
  const p = plugins?.sort().join(',') || 'all';
  return `pansou:${kw.toLowerCase()}:${src}:${p}`;
}

async function getCached(key: string): Promise<SearchResponse | null> {
  try {
    // @ts-ignore
    if (typeof caches !== 'undefined') {
      // @ts-ignore
      const cache = caches.default;
      const res = await cache.match(`https://pansou-cache/${key}`);
      if (res) return await res.json() as SearchResponse;
    }
  } catch {}
  return null;
}

async function setCached(key: string, data: SearchResponse): Promise<void> {
  try {
    // @ts-ignore
    if (typeof caches !== 'undefined') {
      // @ts-ignore
      const cache = caches.default;
      const res = new Response(JSON.stringify(data), {
        headers: { 'Content-Type': 'application/json', 'Cache-Control': `max-age=${CACHE_TTL_SECONDS}` },
      });
      // @ts-ignore
      await cache.put(`https://pansou-cache/${key}`, res);
    }
  } catch {}
}

// ── Step 5: Plugin parameter normalization (Go: searchPlugins lines 365-426) ──

function normalizePlugins(requested: string[] | null | undefined, src: string, allPluginNames: string[]): string[] | null {
  // src=tg → ignore plugins entirely
  if (src === 'tg') return null;

  if (src !== 'all' && src !== 'plugin') src = 'all';

  // null/undefined → use all
  if (requested === null || requested === undefined) {
    // Only enable if this src uses plugins
    return src === 'tg' ? [] : null;
  }

  if (requested.length === 0) return null;

  // Filter empty strings
  const nonEmpty = requested.filter(p => p !== '');
  if (nonEmpty.length === 0) return null;

  // If requested all plugins that exist, treat as null (all enabled)
  if (nonEmpty.length === allPluginNames.length) {
    const requestedLower = new Set(nonEmpty.map(p => p.toLowerCase()));
    const allIncluded = allPluginNames.every(n => requestedLower.has(n.toLowerCase()));
    if (allIncluded) return null;
  }

  return nonEmpty;
}

// ── Main search ──

export async function search(req: SearchRequest, env?: any): Promise<SearchResponse> {
  const config = getConfig(env);
  const keyword = req.kw;
  const src = req.src || 'all';

  // Cache lookup for non-refresh requests
  if (!req.refresh) {
    const ck = cacheKey(keyword, src, req.plugins ?? undefined);
    const cached = await getCached(ck);
    if (cached) return cached;
  }

  // Step 5: Normalize plugins
  const allPlugins = getFiltered(null);
  const allPluginNames = allPlugins.map(p => p.name);
  const normalizedPlugins = normalizePlugins(req.plugins, src, allPluginNames);

  const useTg = (src === 'all' || src === 'tg') && !!(req.channels?.length);
  const usePlugin = (src === 'all' || src === 'plugin') && config.asyncPluginEnabled;

  // Step 1: TG and plugin run as two independent parallel groups
  let tgResults: SearchResult[] = [];
  let pluginResults: SearchResult[] = [];

  const promises: Promise<void>[] = [];

  if (useTg && req.channels) {
    promises.push((async () => {
      const tasks = req.channels!.slice(0, 3).map(ch => () => searchTGChannel(ch, keyword));
      const all = await runWithConcurrency(tasks, Math.min(req.conc || 10, 20));
      tgResults = all.flat();
    })());
  }

  if (usePlugin) {
    promises.push((async () => {
      const pluginList = getFiltered(normalizedPlugins);
      const conc = Math.min(req.conc || 10, 20);
      const tasks = pluginList.slice(0, conc).map(p => () => searchPlugin(p.name, keyword));
      const all = await runWithConcurrency(tasks, conc);
      pluginResults = all.flat();
    })());
  }

  // Wait for both groups with overall timeout
  const groupPromise = Promise.allSettled(promises);
  const timeoutPromise = new Promise<void>(resolve => setTimeout(resolve, OVERALL_TIMEOUT_MS));
  await Promise.race([groupPromise, timeoutPromise]);

  // Step 3: Smart merge with completeness scoring
  let allResults = mergeSearchResults(tgResults, pluginResults);

  // Step 2/5: Sort by time + keyword + plugin level
  const ranked = rankResults(allResults);

  // Step 4: Filter results field — only high-quality results go in results
  const filteredForResults = ranked.filter(r => {
    const source = r.channel || '';
    const level = getPluginLevelBySource(source);
    // Keep if: has datetime OR has priority keywords OR is high-level plugin (1-2)
    return !!r.datetime || getKeywordPriority(r.title) > 0 || level <= 2;
  });

  // Cloud type filter
  let finalForMerged = ranked;
  if (req.cloud_types && req.cloud_types.length > 0) {
    finalForMerged = ranked.filter(r =>
      r.links.some(l => req.cloud_types!.includes(l.type))
    );
    const filteredResultsForMerged = finalForMerged.filter(r => filteredForResults.includes(r));
    filteredForResults.length = 0;
    filteredForResults.push(...filteredResultsForMerged);
  }

  // Merge by type — uses ALL results, not just filtered
  const mergedLinks = mergeResultsByType(finalForMerged, keyword);

  const resType = req.res || 'merged_by_type';
  let total: number;
  if (resType === 'merged_by_type') {
    total = Object.values(mergedLinks).reduce((s, arr) => s + arr.length, 0);
  } else {
    total = filteredForResults.length;
  }

  const response: SearchResponse = resType === 'results'
    ? { total, results: filteredForResults.slice(0, 200) }
    : { total, merged_by_type: mergedLinks, results: filteredForResults.slice(0, 200) };

  // Cache the result
  const ck = cacheKey(keyword, src, req.plugins ?? undefined);
  (async () => { try { await setCached(ck, response); } catch {} })();

  return response;
}

// ── TG Channel ──

async function searchTGChannel(channel: string, keyword: string): Promise<SearchResult[]> {
  try {
    const url = `https://${channel}.pages.dev/search?q=${encodeURIComponent(keyword)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TG_TIMEOUT_MS);
    const res = await fetch(url, {
      headers: { 'User-Agent': 'PanSou/2.0' },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return [];
    const data = await res.json() as any;
    const items = data?.results || data?.data || [];
    if (!Array.isArray(items)) return [];
    return items.slice(0, 20).map((item: any, idx: number) => ({
      message_id: item.message_id || `${channel}_${idx}`,
      unique_id: item.unique_id || item.url || `${channel}_${idx}`,
      channel: `tg:${channel}`,
      datetime: item.datetime || new Date().toISOString(),
      title: item.title || keyword,
      content: item.content || '',
      links: item.links || [],
      images: item.images || [],
    }));
  } catch { return []; }
}

// ── Plugin ──

async function searchPlugin(name: string, keyword: string): Promise<SearchResult[]> {
  try {
    const plugin = getByName(name);
    if (!plugin) return [];
    const promise = plugin.search(keyword);
    const timeoutPromise = new Promise<SearchResult[]>((r) => setTimeout(() => r([]), PLUGIN_TIMEOUT_MS));
    const results = await Promise.race([promise, timeoutPromise]);
    return results.map(r => ({ ...r, channel: `plugin:${name}` }));
  } catch { return []; }
}

// ── Concurrency ──

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, max: number): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += max) {
    const batch = tasks.slice(i, i + max);
    const settled = await Promise.allSettled(batch.map(fn => fn()));
    for (const r of settled) {
      if (r.status === 'fulfilled') results.push(r.value);
    }
  }
  return results;
}

// ── Step 2: Link-title extraction from message content (Go: extractLinkTitlePairs + helpers) ──

function extractLinkTitlePairs(content: string): Map<string, string> {
  if (!content) return new Map();

  if (content.includes('\n')) {
    return extractLinkTitlePairsWithNewlines(content);
  }
  return extractLinkTitlePairsWithoutNewlines(content);
}

// ── Step 2a: With newlines — scan line by line, match title→link pairs ──

function extractLinkTitlePairsWithNewlines(content: string): Map<string, string> {
  const map = new Map<string, string>();
  const lines = content.split('\n');
  let lastTitle = '';
  let lastTitleIdx = -1;

  // First pass: find title→link pairs
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;

    const links = extractAllUrls(line);

    if (links.length > 0) {
      const standardLinkLine = isLinkLine(line);

      if (standardLinkLine && lastTitle) {
        // Standard link line (链接：url) — use previous title
        for (const link of links) map.set(link, lastTitle);
      } else if (!standardLinkLine) {
        const titleFromLine = extractTitleFromLinkLine(line);
        if (titleFromLine) {
          for (const link of links) map.set(link, titleFromLine);
        } else if (lastTitle) {
          for (const link of links) map.set(link, lastTitle);
        }
      }
    } else {
      // Potential title line
      if (i + 1 < lines.length) {
        const nextLine = lines[i + 1].trim();
        if (isLinkLine(nextLine) || extractAllUrls(nextLine).length > 0) {
          const cleaned = cleanTitle(line);
          if (cleaned) { lastTitle = cleaned; lastTitleIdx = i; }
        }
      } else {
        const cleaned = cleanTitle(line);
        if (cleaned) { lastTitle = cleaned; lastTitleIdx = i; }
      }
    }
  }

  // Second pass: for links without a title, find nearest title above
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i].trim();
    if (!line) continue;
    const links = extractAllUrls(line);
    if (links.length === 0) continue;

    for (const link of links) {
      if (map.has(link)) continue;
      // Search upwards for nearest title
      for (let j = i - 1; j >= 0; j--) {
        const candidate = lines[j].trim();
        if (!candidate || isLinkLine(candidate) || extractAllUrls(candidate).length > 0) continue;
        const cleaned = cleanTitle(candidate);
        if (cleaned) { map.set(link, cleaned); break; }
      }
    }
  }

  return map;
}

// ── Step 2b: Without newlines — split by netdisk link positions ──

function extractLinkTitlePairsWithoutNewlines(content: string): Map<string, string> {
  const map = new Map<string, string>();

  type LinkPos = { url: string; pos: number };
  const allLinks: LinkPos[] = [];
  const seen = new Set<string>();

  for (const pattern of NETDISK_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(content)) !== null) {
      const url = m[0];
      const normalized = normalizeUrlForDedup(url);
      if (!seen.has(normalized)) {
        seen.add(normalized);
        allLinks.push({ url, pos: m.index });
      }
    }
  }

  if (allLinks.length === 0) return map;

  // Sort by position
  allLinks.sort((a, b) => a.pos - b.pos);

  // Split content into segments: text before each link
  for (let i = 0; i < allLinks.length; i++) {
    const link = allLinks[i];
    const segStart = i === 0 ? 0 : (allLinks[i - 1].pos + allLinks[i - 1].url.length);
    const segEnd = link.pos;
    const segment = content.substring(segStart, segEnd);

    const title = extractTitleBeforeLink(segment);
    if (title) map.set(link.url, title);
  }

  return map;
}

function extractTitleBeforeLink(text: string): string {
  text = text.trim();
  if (!text) return '';

  // Remove "链接：" prefix text
  const colonIdx = text.lastIndexOf('链接：');
  if (colonIdx === -1) {
    const colonIdx2 = text.lastIndexOf('链接:');
    if (colonIdx2 === -1) return cleanTitle(text);
    return cleanTitle(text.substring(colonIdx2 + 3));
  }
  return cleanTitle(text.substring(colonIdx + 3));
}

// ── Shared helpers for title extraction ──

function isLinkLine(line: string): boolean {
  const lower = line.toLowerCase();
  return lower.startsWith('链接：') || lower.startsWith('地址：') || lower.startsWith('资源地址：')
    || lower.startsWith('网盘：') || lower.startsWith('网盘地址：') || lower.startsWith('链接:');
}

function extractTitleFromLinkLine(line: string): string {
  // "Title：url" pattern
  const partsCN = line.split('：');
  if (partsCN.length === 2 && !partsCN[0].includes('http') && !isLinkPrefix(partsCN[0])) {
    return cleanTitle(partsCN[0]);
  }
  const partsEN = line.split(':');
  if (partsEN.length === 2 && !partsEN[0].includes('http') && !isLinkPrefix(partsEN[0])) {
    return cleanTitle(partsEN[0]);
  }
  return '';
}

function isLinkPrefix(text: string): boolean {
  const t = text.trim().toLowerCase();
  if (['链接', '地址', '资源地址', '网盘', '网盘地址'].includes(t)) return true;
  return CLOUD_DISK_NAMES.has(text.trim());
}

function cleanTitle(title: string): string {
  title = title.trim();
  title = title.replace(/^(名称|标题|片名)[：:]\s*/, '');
  // Remove emoji
  title = title.replace(/[\u{1F000}-\u{1FFFF}]/gu, '');
  title = title.replace(/[\u{2600}-\u{27BF}]/gu, '');
  title = title.replace(/[\u{FE00}-\u{FEFF}]/gu, '');
  return title.trim();
}

function extractAllUrls(text: string): string[] {
  const urls: string[] = [];
  for (const pattern of NETDISK_PATTERNS) {
    pattern.lastIndex = 0;
    let m;
    while ((m = pattern.exec(text)) !== null) {
      urls.push(m[0]);
    }
  }
  return urls;
}

// ── Step 3: Smart merge with completeness scoring (Go: mergeSearchResults + selectBetterResult) ──

function generateResultKey(r: SearchResult): string {
  if (r.unique_id) return r.unique_id;
  if (r.message_id) return r.message_id;
  return `title_${r.title}_${r.channel}`;
}

function calculateCompletenessScore(r: SearchResult): number {
  let score = 0;
  if (r.unique_id) score += 10;
  if (r.links.length > 0) {
    score += 5;
    score += r.links.length;
  }
  if (r.content) score += 3;
  score += r.title.length / 10;
  if (r.channel) score += 2;
  score += (r.tags?.length || 0);
  return Math.floor(score);
}

function selectBetterResult(a: SearchResult, b: SearchResult): SearchResult {
  return calculateCompletenessScore(b) > calculateCompletenessScore(a) ? b : a;
}

function mergeSearchResults(existing: SearchResult[], newResults: SearchResult[]): SearchResult[] {
  const map = new Map<string, SearchResult>();

  for (const r of existing) {
    map.set(generateResultKey(r), r);
  }

  for (const r of newResults) {
    const key = generateResultKey(r);
    const prev = map.get(key);
    if (prev) {
      // Keep the better one
      const better = selectBetterResult(prev, r);
      map.set(key, better);
      // Merge links from the other one, avoiding duplicates
      const other = better === prev ? r : prev;
      const existingUrls = new Set(better.links.map(l => normalizeUrlForDedup(l.url)));
      for (const link of other.links) {
        if (!existingUrls.has(normalizeUrlForDedup(link.url))) {
          better.links.push(link);
        }
      }
    } else {
      map.set(key, r);
    }
  }

  return Array.from(map.values());
}

// ── Ranking (Go: sortResultsByTimeAndKeywords) ──

function getKeywordPriority(title: string): number {
  for (let i = 0; i < PRIORITY_KEYWORDS.length; i++) {
    if (title.includes(PRIORITY_KEYWORDS[i])) {
      return (PRIORITY_KEYWORDS.length - i) * 70;
    }
  }
  return 0;
}

function getPluginLevelBySource(source: string): number {
  if (source.startsWith('tg:')) return 3;
  if (source.startsWith('plugin:')) {
    const name = source.slice(7);
    const plugin = getByName(name);
    return plugin?.priority || 3;
  }
  return 3;
}

function getPluginScore(level: number): number {
  switch (level) { case 1: return 1000; case 2: return 500; case 3: return 0; case 4: return -200; default: return 0; }
}

function getTimeScore(datetime: string): number {
  if (!datetime) return 0;
  const d = new Date(datetime);
  if (isNaN(d.getTime())) return 0;
  const days = (Date.now() - d.getTime()) / (24 * 3600_000);
  if (days <= 1) return 500; if (days <= 3) return 400; if (days <= 7) return 300;
  if (days <= 30) return 200; if (days <= 90) return 100; if (days <= 365) return 50;
  return 20;
}

function rankResults(results: SearchResult[]): SearchResult[] {
  const scored = results.map(r => {
    const level = getPluginLevelBySource(r.channel || '');
    return { result: r, score: getTimeScore(r.datetime) + getKeywordPriority(r.title) + getPluginScore(level) };
  });
  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.result);
}

// ── Merge by type (Go: mergeResultsByType) ──

function mergeResultsByType(results: SearchResult[], keyword: string): MergedLinks {
  const merged: Record<string, MergedLink[]> = {};
  const seenUrls = new Map<string, MergedLink>();
  const lowerKeyword = keyword.toLowerCase();

  for (const r of results) {
    // Step 2: Extract per-link titles from message content
    const linkTitleMap = extractLinkTitlePairs(r.content);

    // Also try "linkPrefixes" fallback for non-newline content (Go: 1004-1057)
    if (linkTitleMap.size === 0 && r.links.length > 0 && !r.content.includes('\n')) {
      const linkPrefixes = ['天翼链接：', '百度链接：', '夸克链接：', '阿里链接：', 'UC链接：', '115链接：', '迅雷链接：', '123链接：', '链接：'];
      for (const prefix of linkPrefixes) {
        if (r.content.includes(prefix)) {
          const parts = r.content.split(prefix);
          if (parts.length > 1 && r.links.length <= parts.length - 1) {
            const titles: string[] = [cleanTitle(parts[0])];
            for (let i = 1; i < parts.length - 1; i++) {
              const linkEnd = findFirstDelimiter(parts[i]);
              if (linkEnd > 0) titles.push(cleanTitle(parts[i].substring(linkEnd)));
            }
            for (let i = 0; i < r.links.length && i < titles.length; i++) {
              linkTitleMap.set(r.links[i].url, titles[i]);
            }
          }
          break;
        }
      }
    }

    // Determine if this plugin skips service filter
    let skipKeywordFilter = false;
    if (r.unique_id && r.unique_id.includes('-')) {
      const [pluginName] = r.unique_id.split('-');
      const plugin = getByName(pluginName);
      if (plugin?.skipServiceFilter) skipKeywordFilter = true;
    }

    for (const link of r.links) {
      // Determine per-link title (Go: lines 1060-1080)
      let title = r.title;
      if (link.work_title) {
        title = link.work_title;
      } else {
        const specificTitle = linkTitleMap.get(link.url);
        if (specificTitle) {
          title = specificTitle;
        } else {
          // Try prefix match
          for (const [mappedUrl, mappedTitle] of linkTitleMap) {
            if (mappedUrl.startsWith(link.url)) { title = mappedTitle; break; }
          }
        }
      }

      // Keyword filter per-link
      if (!skipKeywordFilter && keyword) {
        if (!title.toLowerCase().includes(lowerKeyword)) continue;
      }

      // Trim title at keywords like 简介/描述 (Go: util.CutTitleByKeywords)
      const cutIdx = title.search(/简介|描述/);
      if (cutIdx > 0) title = title.substring(0, cutIdx);

      const type = link.type || 'unknown';
      if (!merged[type]) merged[type] = [];

      const normUrl = normalizeUrlForDedup(link.url);
      const existing = seenUrls.get(normUrl);

      // Source attribution
      let source = r.channel || '';
      if (!source && r.unique_id?.includes('-')) {
        source = 'plugin:' + r.unique_id.split('-')[0];
      }

      if (existing) {
        if (r.datetime && (!existing.datetime || r.datetime > existing.datetime)) {
          existing.datetime = r.datetime;
          existing.note = title;
          existing.source = source;
        }
        if (!existing.password && link.password) existing.password = link.password;
      } else {
        const ml: MergedLink = {
          url: link.url,
          password: link.password,
          note: title,
          datetime: r.datetime,
          source,
          images: r.images,
        };
        merged[type].push(ml);
        seenUrls.set(normUrl, ml);
      }
    }
  }

  return merged;
}

function findFirstDelimiter(s: string): number {
  const delimiters = /[窃东西迎千我恋将野合天翼网盘（(\s]/;
  const m = s.match(delimiters);
  return m ? (m.index ?? -1) : -1;
}

// ── URL normalization ──

function normalizeUrlForDedup(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.host = u.host.toLowerCase();
    for (const p of ['ref', 'source', 'utm_source', 'utm_medium', 'utm_campaign', 'spm', 'from', 'track_id']) {
      u.searchParams.delete(p);
    }
    return u.toString();
  } catch { return url; }
}
