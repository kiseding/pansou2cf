import { getConfig } from '../config';
import { getFiltered, getByName } from '../plugin/registry';
import type { SearchRequest, SearchResponse, SearchResult as SR, MergedLinks, MergedLink, Link } from '../types';
import { bootPlugins } from '../plugin/boot';
import { extractLinksFromText } from '../plugin/netdisk-patterns';
import { DynamicPool } from './scheduler';
import { getHealth, getPriority, recordSuccess, recordFailure, isCircuitBroken } from './plugin-health';
bootPlugins();

const RESULT_CACHE_TTL = 60_000;
const SSE_CACHE_TTL = 30;

const PRIORITY_KEYWORDS = ['合集', '系列', '全', '完', '最新', '附', 'complete'];

// ── Result cache (memory) ──
const resultCache = new Map<string, { expires: number; merged: MergedLinks; results: SR[] }>();

function cacheResults(key: string, merged: MergedLinks, results: SR[]): void {
  resultCache.set(key, { expires: Date.now() + RESULT_CACHE_TTL, merged, results });
}

// ── Main search: streaming (SSE) or JSON ──

export async function search(req: SearchRequest, env?: any, stream = false): Promise<SearchResponse | ReadableStream> {
  const config = getConfig(env);
  const keyword = req.kw;
  const src = req.src || 'all';
  const normalized = normalizePlugins(req.plugins, src, getFiltered(null).map(p => p.name));

  // Cache check (non-stream, non-refresh)
  const ck = `rs:${keyword.toLowerCase()}:${src}:${(normalized ?? []).sort().join(',')}`;
  if (!stream && !req.refresh) {
    const cached = resultCache.get(ck);
    if (cached && cached.expires > Date.now()) {
      return { total: Object.values(cached.merged).reduce((s, a) => s + a.length, 0), merged_by_type: cached.merged, results: cached.results };
    }
  }

  // Build task lists
  const useTg = (src === 'all' || src === 'tg') && !!(req.channels?.length);
  const usePlugin = (src === 'all' || src === 'plugin') && config.asyncPluginEnabled;

  const allTasks: Array<{ fn: () => Promise<SR[]>; id: string; priority: number }> = [];

  if (useTg && req.channels) {
    for (const ch of req.channels.slice(0, 80)) {
      allTasks.push({ fn: () => searchTGChannel(ch, keyword), id: `tg:${ch}`, priority: 5 });
    }
  }

  if (usePlugin) {
    const plugins = getFiltered(normalized);
    for (const p of plugins) {
      if (isCircuitBroken(p.name)) continue;
      allTasks.push({
        fn: () => searchPluginTimed(p.name, keyword),
        id: `plugin:${p.name}`,
        priority: getPriority(p.name),
      });
    }
  }

  // Sort by priority
  allTasks.sort((a, b) => a.priority - b.priority);

  if (!stream) {
    // JSON mode: collect all results and return
    return await collectAndReturn(allTasks, ck, keyword, req);
  }

  // SSE mode: stream results
  return createSSEStream(allTasks, ck, keyword, req);
}

async function collectAndReturn(tasks: Array<{ fn: () => Promise<SR[]>; id: string }>, ck: string, keyword: string, req: SearchRequest): Promise<SearchResponse> {
  const pool = new DynamicPool<SR[]>(6, 12000);
  const collected: SR[] = [];

  for (const t of tasks) pool.add(t.fn, t.id, 0);

  const results = await pool.execute((_id, value) => {
    collected.push(...value);
  });

  const merged = mergeAndRank(collected, keyword, req);
  const final: SR[] = merged.all.slice(0, 200);

  // Cache
  const total = Object.values(merged.byType).reduce((s, a) => s + a.length, 0);
  cacheResults(ck, merged.byType, final);

  return { total, merged_by_type: merged.byType, results: final };
}

function createSSEStream(tasks: Array<{ fn: () => Promise<SR[]>; id: string }>, _ck: string, keyword: string, req: SearchRequest): ReadableStream {
  let collected: SR[] = [];
  const encoder = new TextEncoder();

  return new ReadableStream({
    async start(controller) {
      const sse = (data: any) => {
        controller.enqueue(encoder.encode(`data: ${JSON.stringify(data)}\n\n`));
      };

      // Split tasks into tiers based on existing health
      const t1 = tasks.filter(t => {
        const name = t.id.replace('plugin:', '');
        return getHealth(name).successRate >= 0.5 && getHealth(name).avgLatencyMs < 5000;
      });
      const t2 = tasks.filter(t => {
        const name = t.id.replace('plugin:', '');
        return getHealth(name).successRate >= 0.2 && !t1.includes(t);
      });
      const t3 = tasks.filter(t => !t1.includes(t) && !t2.includes(t));

      // Layer 1: fast plugins
      if (t1.length > 0) {
        const pool = new DynamicPool<SR[]>(5, 6000);
        for (const t of t1) pool.add(t.fn, t.id, 0);
        const r1 = await pool.execute((_id, value) => {
          collected.push(...value);
        });
        const l1 = mergeAndRank([...r1.flat()], keyword, req);
        sse({ layer: 1, total: l1.all.length, results: l1.all.slice(0, 100) });
      }

      // Layer 2: medium plugins
      if (t2.length > 0) {
        const pool = new DynamicPool<SR[]>(4, 8000);
        for (const t of t2) pool.add(t.fn, t.id, 0);
        const r2 = await pool.execute((_id, value) => {
          collected.push(...value);
        });
        const l2 = mergeAndRank(collected, keyword, req);
        sse({ layer: 2, total: l2.all.length, results: l2.all.slice(100, 200) });
      }

      // Layer 3: slow/unreliable (background)
      if (t3.length > 0) {
        const pool = new DynamicPool<SR[]>(3, 6000);
        for (const t of t3) pool.add(t.fn, t.id, 0);
        await pool.execute((_id, value) => {
          collected.push(...value);
        });
      }

      // Final: all merged
      const final = mergeAndRank(collected, keyword, req);
      sse({ done: true, total: Object.values(final.byType).reduce((s, a) => s + a.length, 0), merged_by_type: final.byType, results: final.all.slice(0, 200) });

      controller.close();
    },
  });
}

// ── Plugin search with timing ──

async function searchPluginTimed(name: string, keyword: string): Promise<SR[]> {
  const start = Date.now();
  try {
    const plugin = getByName(name);
    if (!plugin) return [];

    const ck = `${name}:${keyword.toLowerCase()}`;
    const cached = pluginCache.get(ck);
    if (cached && cached.expires > Date.now()) return cached.results;

    let data: SR[] = [];
    const p = plugin.search(keyword).then(r => { data = r; return r; });
    const timeout = new Promise<SR[]>((r) => setTimeout(() => r(data), 12000));
    const result = await Promise.race([p, timeout]);

    const elapsed = Date.now() - start;
    if (result.length > 0) {
      recordSuccess(name, elapsed);
    } else if (elapsed >= 12000) {
      recordFailure(name, true);
    } else {
      recordFailure(name, false);
    }

    const tagged = result.map(r => ({ ...r, channel: `plugin:${name}` }));
    pluginCache.set(ck, { results: tagged, expires: Date.now() + 300_000 });
    return tagged;
  } catch {
    recordFailure(name, false);
    return [];
  }
}

// ── Plugin cache (5 min) ──
const pluginCache = new Map<string, { results: SR[]; expires: number }>();

// ── TG Channel search ──

async function searchTGChannel(channel: string, keyword: string): Promise<SR[]> {
  const results = await tryTMeSearch(channel, keyword);
  if (results.length > 0) return results;
  return tryPagesDevSearch(channel, keyword);
}

async function tryTMeSearch(channel: string, keyword: string): Promise<SR[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 8000);
    const res = await fetch(`https://t.me/s/${channel}?q=${encodeURIComponent(keyword)}`, {
      headers: {
        'User-Agent': 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/91.0.4472.124 Safari/537.36',
        'Accept': 'text/html,application/xhtml+xml,application/xml;q=0.9,*/*;q=0.8',
        'Accept-Language': 'en-US,en;q=0.5',
      },
      signal: ctrl.signal,
    });
    clearTimeout(t);
    if (!res.ok) return [];
    return parseTelegramHTML(await res.text(), channel);
  } catch { return []; }
}

async function tryPagesDevSearch(channel: string, keyword: string): Promise<SR[]> {
  try {
    const ctrl = new AbortController();
    const t = setTimeout(() => ctrl.abort(), 5000);
    const res = await fetch(`https://${channel}.pages.dev/search?q=${encodeURIComponent(keyword)}`, {
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
      title: item.title || 'TG_' + idx,
      content: item.content || '',
      links: item.links || [],
      images: item.images || [],
    }));
  } catch { return []; }
}

// ── Merge + Rank ──

function mergeAndRank(results: SR[], keyword: string, req: SearchRequest): { all: SR[]; byType: MergedLinks } {
  // Dedup by unique_id
  const map = new Map<string, SR>();
  for (const r of results) {
    const key = r.unique_id || r.url || r.message_id || '';
    if (!key) continue;
    const existing = map.get(key);
    if (existing) {
      // Merge links
      const existingUrls = new Set(existing.links.map(l => normalizeUrlForDedup(l.url)));
      for (const l of r.links) {
        if (!existingUrls.has(normalizeUrlForDedup(l.url))) {
          existing.links.push(l);
        }
      }
    } else {
      map.set(key, r);
    }
  }

  let deduped = Array.from(map.values());

  // Score and rank
  deduped.sort((a, b) => scoreResult(b) - scoreResult(a));

  // Cloud type filter
  if (req.cloud_types?.length) {
    deduped = deduped.filter(r => r.links.some(l => req.cloud_types!.includes(l.type)));
  }

  // Merge by type
  const byType: MergedLinks = {};
  const seenUrls = new Map<string, MergedLink>();
  const lowerKw = keyword.toLowerCase();

  for (const r of deduped) {
    for (const link of r.links) {
      // Keyword filter
      if (keyword && !r.title.toLowerCase().includes(lowerKw) && !(r.content || '').toLowerCase().includes(lowerKw)) continue;

      const type = link.type || 'unknown';
      if (!byType[type]) byType[type] = [];
      const nu = normalizeUrlForDedup(link.url);

      if (seenUrls.has(nu)) {
        const ex = seenUrls.get(nu)!;
        if (r.datetime && (!ex.datetime || r.datetime > ex.datetime)) {
          ex.datetime = r.datetime;
          ex.note = r.title;
        }
        if (!ex.password && link.password) ex.password = link.password;
      } else {
        const ml: MergedLink = { url: link.url, password: link.password || '', note: r.title, datetime: r.datetime, source: r.channel, images: r.images };
        byType[type].push(ml);
        seenUrls.set(nu, ml);
      }
    }
  }

  return { all: deduped, byType };
}

function scoreResult(r: SR): number {
  let s = 0;
  if (r.datetime) {
    const days = (Date.now() - new Date(r.datetime).getTime()) / 86400000;
    if (days <= 1) s += 500; else if (days <= 3) s += 400; else if (days <= 7) s += 300; else if (days <= 30) s += 200;
  }
  for (let i = 0; i < PRIORITY_KEYWORDS.length; i++) {
    if (r.title.includes(PRIORITY_KEYWORDS[i])) s += (PRIORITY_KEYWORDS.length - i) * 70;
  }
  s += r.links.length * 5;
  if (r.content) s += Math.min(r.content.length, 50);
  return s;
}

// ── Helpers ──

function normalizeUrlForDedup(u: string): string {
  try { const p = new URL(u); p.hash = ''; p.host = p.host.toLowerCase(); return p.toString(); } catch { return u; }
}

function normalizePlugins(requested: string[] | null | undefined, src: string, allNames: string[]): string[] | null {
  if (src === 'tg') return null;
  if (!requested || requested.length === 0) return null;
  const nonEmpty = requested.filter(p => p !== '');
  if (nonEmpty.length === 0) return null;
  if (nonEmpty.length === allNames.length && allNames.every(n => nonEmpty.map(p => p.toLowerCase()).includes(n.toLowerCase()))) return null;
  return nonEmpty;
}

// ── TG HTML parser ──

function parseTelegramHTML(html: string, channel: string): SR[] {
  const results: SR[] = [];
  const wraps = html.split(/<div\s+class="tgme_widget_message_wrap/gi).slice(1);
  for (let idx = 0; idx < wraps.length && idx < 50; idx++) {
    const wrap = wraps[idx];
    const msgMatch = wrap.match(/<div\s+class="tgme_widget_message\b[^"]*"\s+data-post="([^"]*)"/i);
    if (!msgMatch) continue;
    const postId = msgMatch[1];
    const textMatch = wrap.match(/<div\s+class="tgme_widget_message_text[^"]*"[^>]*>([\s\S]*?)<\/div>/i);
    if (!textMatch) continue;
    const content = textMatch[1].replace(/<[^>]*>/g, '\n').replace(/&amp;/g, '&').replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').trim();
    const links = extractLinksFromText(content);
    if (links.length === 0) continue;
    const seen = new Set<string>();
    const unique = links.filter(l => { if (seen.has(l.url)) return false; seen.add(l.url); return true; });
    const timeMatch = wrap.match(/<time[^>]*datetime="([^"]*)"/i);
    const title = content.split('\n')[0]?.replace(/^[@\s\d./#_-]+/, '').trim().slice(0, 80) || `tg_${idx}`;
    results.push({
      message_id: postId, unique_id: postId,
      channel: `tg:${channel}`, datetime: timeMatch?.[1] || new Date().toISOString(),
      title, content: content.slice(0, 500),
      links: unique.map(l => ({ type: l.type, url: l.url, password: l.password })),
      images: [],
    });
  }
  return results;
}
