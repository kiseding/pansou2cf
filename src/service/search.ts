import { getConfig } from '../config';
import { getFiltered, getByName } from '../plugin/registry';
import type { SearchRequest, SearchResponse, SearchResult, MergedLinks, MergedLink } from '../types';
import { bootPlugins } from '../plugin/boot';
bootPlugins();

const PLUGIN_TIMEOUT_MS = 8000;
const TG_TIMEOUT_MS = 5000;
const OVERALL_TIMEOUT_MS = 20000;
const CACHE_TTL_SECONDS = 600; // 10 min

// Priority keywords for ranking (same as Go version)
const PRIORITY_KEYWORDS = ['合集', '系列', '全', '完', '最新', '附', 'complete'];

// Use Cloudflare Cache API when available (works without KV binding)
function cacheKey(kw: string, src: string, plugins?: string[]): string {
  const p = plugins?.sort().join(',') || 'all';
  return `pansou:${kw.toLowerCase()}:${src}:${p}`;
}

async function getCached(key: string): Promise<SearchResponse | null> {
  try {
    // @ts-ignore — Cloudflare Workers runtime
    if (typeof caches !== 'undefined') {
      // @ts-ignore
      const cache = caches.default;
      const res = await cache.match(`https://pansou-cache/${key}`);
      if (res) {
        const data = await res.json();
        return data as SearchResponse;
      }
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

// ── Main search function ──

export async function search(req: SearchRequest, env?: any): Promise<SearchResponse> {
  const config = getConfig(env);
  const keyword = req.kw;
  const conc = Math.min(req.conc || 10, 20);
  const src = req.src || 'all';

  // Cache for non-refresh requests
  if (!req.refresh) {
    const ck = cacheKey(keyword, src, req.plugins ?? undefined);
    const cached = await getCached(ck);
    if (cached) return cached;
  }

  const results: SearchResult[] = [];
  const useTg = (src === 'all' || src === 'tg') && !!(req.channels?.length);
  const usePlugin = src === 'all' || src === 'plugin';

  const tasks: Array<() => Promise<SearchResult[]>> = [];

  // TG channel search
  if (useTg && req.channels) {
    for (const ch of req.channels.slice(0, 3)) {
      tasks.push(() => searchTGChannel(ch, keyword));
    }
  }

  // Plugin search
  if (usePlugin && config.asyncPluginEnabled) {
    const plugins = getFiltered(
      req.plugins !== undefined ? req.plugins : config.enabledPlugins
    );
    const slotCount = Math.max(0, conc - tasks.length);
    for (const p of plugins.slice(0, slotCount)) {
      tasks.push(() => searchPlugin(p.name, keyword));
    }
  }

  if (tasks.length === 0) {
    return { total: 0, merged_by_type: {}, results: [] };
  }

  // Execute with overall timeout
  const overallPromise = runWithConcurrency(tasks, conc);
  const timeoutPromise = new Promise<SearchResult[][]>((resolve) => {
    setTimeout(() => resolve([]), OVERALL_TIMEOUT_MS);
  });

  const allResults = await Promise.race([overallPromise, timeoutPromise]);
  for (const r of allResults) results.push(...r);

  // Deduplicate by unique_id with smart merging
  const deduped = deduplicateWithMerge(results);

  // Rank by time + keyword priority + plugin level
  const ranked = rankResults(deduped);

  // Cloud type filter
  let final = ranked;
  if (req.cloud_types && req.cloud_types.length > 0) {
    final = ranked.filter(r =>
      r.links.some(l => req.cloud_types!.includes(l.type))
    );
  }

  const res = req.res || 'merged_by_type';
  const response: SearchResponse = res === 'results'
    ? { total: final.length, results: final.slice(0, 200) }
    : { total: final.length, merged_by_type: mergeByType(final), results: final.slice(0, 200) };

  // Cache the result
  const ck = cacheKey(keyword, src, req.plugins ?? undefined);
  (async () => { try { await setCached(ck, response); } catch {} })();

  return response;
}

// ── TG Channel search ──

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

// ── Plugin search ──

async function searchPlugin(name: string, keyword: string): Promise<SearchResult[]> {
  try {
    const plugin = getByName(name);
    if (!plugin) return [];

    const promise = plugin.search(keyword);
    const timeoutPromise = new Promise<SearchResult[]>((resolve) => {
      setTimeout(() => resolve([]), PLUGIN_TIMEOUT_MS);
    });

    const results = await Promise.race([promise, timeoutPromise]);
    return results.map(r => ({ ...r, channel: `plugin:${name}` }));
  } catch { return []; }
}

// ── Concurrency ──

async function runWithConcurrency<T>(tasks: Array<() => Promise<T>>, max: number): Promise<T[]> {
  const results: T[] = [];
  for (let i = 0; i < tasks.length; i += max) {
    const batch = tasks.slice(i, i + max);
    const batchResults = await Promise.allSettled(batch.map(fn => fn()));
    for (const r of batchResults) {
      if (r.status === 'fulfilled') results.push(r.value);
    }
  }
  return results;
}

// ── Deduplication with smart merge ──

function normalizeUrlForDedup(url: string): string {
  try {
    const u = new URL(url);
    u.hash = '';
    u.host = u.host.toLowerCase();
    // Remove tracking params
    const removeParams = ['ref', 'source', 'utm_source', 'utm_medium', 'utm_campaign', 'spm', 'from', 'track_id'];
    for (const p of removeParams) u.searchParams.delete(p);
    return u.toString();
  } catch { return url; }
}

function deduplicateWithMerge(results: SearchResult[]): SearchResult[] {
  const map = new Map<string, SearchResult>();

  for (const r of results) {
    const key = r.unique_id || r.url || r.message_id || '';
    if (!key) continue;

    const existing = map.get(key);
    if (existing) {
      // Merge: keep the one with more links
      if (r.links.length > existing.links.length) {
        map.set(key, r);
      } else {
        // Merge links, avoiding duplicates
        const existingUrls = new Set(existing.links.map(l => normalizeUrlForDedup(l.url)));
        for (const link of r.links) {
          if (!existingUrls.has(normalizeUrlForDedup(link.url))) {
            existing.links.push(link);
          }
        }
        // Merge images
        if (r.images && existing.images) {
          const imgSet = new Set(existing.images);
          for (const img of r.images) if (!imgSet.has(img)) existing.images.push(img);
        }
      }
    } else {
      map.set(key, r);
    }
  }

  return Array.from(map.values());
}

// ── Ranking ──

function getKeywordPriority(title: string): number {
  const t = title;
  for (let i = 0; i < PRIORITY_KEYWORDS.length; i++) {
    if (t.includes(PRIORITY_KEYWORDS[i])) {
      return (PRIORITY_KEYWORDS.length - i) * 70;
    }
  }
  return 0;
}

function getPluginLevelBySource(channel: string): number {
  if (channel.startsWith('tg:')) return 3;
  if (channel.startsWith('plugin:')) {
    const name = channel.slice(7);
    const plugin = getByName(name);
    return plugin?.priority || 3;
  }
  return 3;
}

function getPluginScore(level: number): number {
  switch (level) {
    case 1: return 1000;
    case 2: return 500;
    case 3: return 0;
    case 4: return -200;
    default: return 0;
  }
}

function getTimeScore(datetime: string): number {
  if (!datetime) return 0;
  const d = new Date(datetime);
  if (isNaN(d.getTime())) return 0;
  const daysAgo = (Date.now() - d.getTime()) / (24 * 3600_000);
  if (daysAgo <= 1) return 500;
  if (daysAgo <= 3) return 400;
  if (daysAgo <= 7) return 300;
  if (daysAgo <= 30) return 200;
  if (daysAgo <= 90) return 100;
  if (daysAgo <= 365) return 50;
  return 20;
}

function rankResults(results: SearchResult[]): SearchResult[] {
  const scored = results.map(r => {
    const level = getPluginLevelBySource(r.channel || '');
    const score = getTimeScore(r.datetime) + getKeywordPriority(r.title) + getPluginScore(level);
    return { result: r, score };
  });

  scored.sort((a, b) => b.score - a.score);
  return scored.map(s => s.result);
}

// ── Merge by type ──

function mergeByType(results: SearchResult[]): MergedLinks {
  const merged: Record<string, MergedLink[]> = {};
  const seenUrls = new Map<string, MergedLink>(); // normalized URL -> existing link

  for (const r of results) {
    for (const link of r.links) {
      const type = link.type || 'unknown';
      if (!merged[type]) merged[type] = [];

      const normUrl = normalizeUrlForDedup(link.url);
      const existing = seenUrls.get(normUrl);

      if (existing) {
        // Keep the one with more recent datetime
        if (r.datetime && (!existing.datetime || r.datetime > existing.datetime)) {
          existing.datetime = r.datetime;
          existing.note = r.title;
          existing.source = r.channel;
        }
        // Merge password if missing
        if (!existing.password && link.password) {
          existing.password = link.password;
        }
      } else {
        const ml: MergedLink = {
          url: link.url,
          password: link.password,
          note: r.title,
          datetime: r.datetime,
          source: r.channel,
          images: r.images,
        };
        merged[type].push(ml);
        seenUrls.set(normUrl, ml);
      }
    }
  }

  return merged;
}
