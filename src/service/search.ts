import { getConfig } from '../config';
import { getFiltered } from '../plugin/registry';
import type { SearchRequest, SearchResponse, SearchResult, MergedLinks, MergedLink } from '../types';

// Import all plugins to trigger registration
import '../plugin/pansearch';
import '../plugin/yunso';
import '../plugin/yunsou';
import '../plugin/qupansou';
import '../plugin/pan666';
import '../plugin/haisou';
import '../plugin/alupan';
import '../plugin/panlian';
import '../plugin/sousou';
import '../plugin/panta';

export async function search(req: SearchRequest, env?: any): Promise<SearchResponse> {
  const config = getConfig(env);
  const keyword = req.kw;
  const conc = req.conc || 20;

  const results: SearchResult[] = [];

  // Determine search sources
  const src = req.src || 'all';
  const useTg = src === 'all' || src === 'tg';
  const usePlugin = src === 'all' || src === 'plugin';

  const tasks: Promise<SearchResult[]>[] = [];

  // TG channel search
  if (useTg && req.channels && req.channels.length > 0) {
    for (const ch of req.channels.slice(0, conc)) {
      tasks.push(searchTGChannel(ch, keyword));
    }
  } else if (useTg && (!req.channels || req.channels.length === 0)) {
    // Use default channels
    for (const ch of config.channels.slice(0, conc)) {
      tasks.push(searchTGChannel(ch, keyword));
    }
  }

  // Plugin search
  if (usePlugin && config.asyncPluginEnabled) {
    const plugins = getFiltered(
      req.plugins !== undefined ? req.plugins : config.enabledPlugins
    );

    for (const p of plugins.slice(0, Math.max(0, conc - tasks.length))) {
      tasks.push(searchPlugin(p.name, keyword));
    }
  }

  // Execute with concurrency limit
  const taskFns = tasks.map(t => () => t);
  const allResults = await runWithConcurrency(taskFns, conc);
  for (const r of allResults) {
    results.push(...r);
  }

  // Deduplicate
  const seen = new Set<string>();
  const deduped: SearchResult[] = [];
  for (const r of results) {
    const key = r.unique_id || r.message_id;
    if (!seen.has(key)) {
      seen.add(key);
      deduped.push(r);
    }
  }

  // Sort by datetime descending
  deduped.sort((a, b) => new Date(b.datetime).getTime() - new Date(a.datetime).getTime());

  // Keyword filter
  const filtered = keyword
    ? deduped.filter(r =>
        r.title.toLowerCase().includes(keyword.toLowerCase()) ||
        r.content.toLowerCase().includes(keyword.toLowerCase())
      )
    : deduped;

  // Cloud type filter
  let final = filtered;
  if (req.cloud_types && req.cloud_types.length > 0) {
    final = filtered.filter(r =>
      r.links.some(l => req.cloud_types!.includes(l.type))
    );
  }

  // Build response based on res type
  const res = req.res || 'merged_by_type';

  if (res === 'results') {
    return { total: final.length, results: final.slice(0, 200) };
  }

  // merged_by_type (default)
  const merged = mergeByType(final);
  return { total: final.length, merged_by_type: merged, results: final.slice(0, 200) };
}

async function searchTGChannel(channel: string, keyword: string): Promise<SearchResult[]> {
  try {
    const url = `https://${channel}.pages.dev/search?q=${encodeURIComponent(keyword)}`;
    const res = await fetch(url, {
      headers: { 'User-Agent': 'Mozilla/5.0' },
    });
    if (!res.ok) return [];
    const data = await res.json() as any;
    const items = data?.results || data?.data || [];
    if (!Array.isArray(items)) return [];
    return items.slice(0, 30).map((item: any, idx: number) => ({
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
    const { getByName } = await import('../plugin/registry');
    const plugin = getByName(name);
    if (!plugin) return [];
    const config = getConfig();
    const result = await withTimeout(
      plugin.search(keyword),
      config.pluginTimeout * 1000
    );
    return result.map(r => ({ ...r, channel: `plugin:${name}` }));
  } catch { return []; }
}

function withTimeout<T>(promise: Promise<T>, ms: number): Promise<T> {
  return Promise.race([
    promise,
    new Promise<T>((_, reject) => setTimeout(() => reject(new Error('timeout')), ms)),
  ]);
}

async function runWithConcurrency<T>(tasks: (() => Promise<T>)[], max: number): Promise<T[]> {
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

      // Deduplicate by URL within type
      const exists = merged[type].find(ml => ml.url === link.url);
      if (!exists) {
        merged[type].push({
          url: link.url,
          password: link.password,
          note: r.title,
          datetime: r.datetime,
          source: r.channel,
          images: r.images,
        });
      }
    }
  }

  return merged;
}
