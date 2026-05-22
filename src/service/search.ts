import { getConfig } from '../config';
import { getFiltered, getByName } from '../plugin/registry';
import type { SearchRequest, SearchResponse, SearchResult, MergedLinks, MergedLink } from '../types';

// Import all plugins to trigger registration
import '../plugin/pansearch';
import '../plugin/yunso';
import '../plugin/alupan';

const PLUGIN_TIMEOUT_MS = 8000;
const TG_TIMEOUT_MS = 5000;
const OVERALL_TIMEOUT_MS = 20000;

export async function search(req: SearchRequest, env?: any): Promise<SearchResponse> {
  const config = getConfig(env);
  const keyword = req.kw;
  const conc = Math.min(req.conc || 10, 20);

  const results: SearchResult[] = [];
  const src = req.src || 'all';
  const useTg = (src === 'all' || src === 'tg') && !!(req.channels?.length);
  const usePlugin = src === 'all' || src === 'plugin';

  const tasks: Array<() => Promise<SearchResult[]>> = [];

  // TG channel search — only if channels explicitly provided
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
  for (const r of allResults) {
    results.push(...r);
  }

  // Deduplicate by unique_id
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const r of results) {
    const key = r.unique_id || r.url || r.message_id;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }

  // Sort by datetime descending
  deduped.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());

  // Cloud type filter
  let final = deduped;
  if (req.cloud_types && req.cloud_types.length > 0) {
    final = deduped.filter(r =>
      r.links.some(l => req.cloud_types!.includes(l.type))
    );
  }

  const res = req.res || 'merged_by_type';
  if (res === 'results') {
    return { total: final.length, results: final.slice(0, 200) };
  }

  const merged = mergeByType(final);
  return { total: final.length, merged_by_type: merged, results: final.slice(0, 200) };
}

async function searchTGChannel(channel: string, keyword: string): Promise<SearchResult[]> {
  try {
    const url = `https://${channel}.pages.dev/search?q=${encodeURIComponent(keyword)}`;
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), TG_TIMEOUT_MS);
    const res = await fetch(url, { headers: { 'User-Agent': 'PanSou/2.0' }, signal: ctrl.signal });
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

async function searchPlugin(name: string, keyword: string): Promise<SearchResult[]> {
  try {
    const plugin = getByName(name);
    if (!plugin) return [];

    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), PLUGIN_TIMEOUT_MS);

    const promise = plugin.search(keyword);
    const timeoutPromise = new Promise<SearchResult[]>((resolve) => {
      setTimeout(() => resolve([]), PLUGIN_TIMEOUT_MS);
    });

    const results = await Promise.race([promise, timeoutPromise]);
    clearTimeout(t);
    return results.map(r => ({ ...r, channel: `plugin:${name}` }));
  } catch { return []; }
}

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

function mergeByType(results: SearchResult[]): MergedLinks {
  const merged: Record<string, MergedLink[]> = {};
  for (const r of results) {
    for (const link of r.links) {
      const type = link.type || 'unknown';
      if (!merged[type]) merged[type] = [];
      const exists = merged[type].find(ml => ml.url === link.url);
      if (!exists) {
        merged[type].push({
          url: link.url, password: link.password,
          note: r.title, datetime: r.datetime,
          source: r.channel, images: r.images,
        });
      }
    }
  }
  return merged;
}
