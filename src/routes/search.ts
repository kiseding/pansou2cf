import { Hono } from 'hono';
import type { SearchRequest } from '../types';
import { search } from '../service/search';
import { successResponse, errorResponse } from '../types';

const searchRoute = new Hono();

searchRoute.get('/', async (c) => {
  const req = parseSearchParams(c.req.query());
  if (!req.kw) return c.json(errorResponse(400, '缺少搜索关键词(kw)'), 400);

  try {
    let result = await search(req, c.env);
    if (req.filter) result = applyFilter(result, req.filter);
    return c.json(successResponse(result));
  } catch (e: any) {
    return c.json(errorResponse(500, '搜索失败: ' + (e?.message || '未知错误')), 500);
  }
});

searchRoute.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const req = parseSearchBody(body);
    if (!req.kw) return c.json(errorResponse(400, '缺少搜索关键词(kw)'), 400);

    let result = await search(req, c.env);
    if (req.filter) result = applyFilter(result, req.filter);
    return c.json(successResponse(result));
  } catch (e: any) {
    return c.json(errorResponse(500, '搜索失败: ' + (e?.message || '未知错误')), 500);
  }
});

function parseSearchParams(q: Record<string, string>): SearchRequest {
  return {
    kw: q.kw || '',
    channels: q.channels ? q.channels.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    conc: q.conc ? parseInt(q.conc) || undefined : undefined,
    refresh: q.refresh === 'true',
    res: q.res || undefined,
    src: q.src || undefined,
    plugins: parseOptionalList(q.plugins),
    cloud_types: q.cloud_types ? q.cloud_types.split(',').map(s => s.trim()).filter(Boolean) : undefined,
    ext: q.ext ? safeJsonParse(q.ext) : undefined,
    filter: q.filter ? safeJsonParse(q.filter) : undefined,
  };
}

function parseSearchBody(body: any): SearchRequest {
  return {
    kw: body.kw || body.keyword || '',
    channels: body.channels,
    conc: body.conc || body.concurrency,
    refresh: body.refresh,
    res: body.res,
    src: body.src,
    plugins: body.plugins,
    cloud_types: body.cloud_types,
    ext: body.ext,
    filter: body.filter,
  };
}

function parseOptionalList(val: string | undefined): string[] | null | undefined {
  if (val === undefined) return undefined;
  if (val === '') return [];
  return val.split(',').map(s => s.trim()).filter(Boolean);
}

function safeJsonParse(s: string): any {
  try { return JSON.parse(s); } catch { return {}; }
}

function applyFilter(result: any, filter: any): any {
  if (!result?.results) return result;
  const include = filter?.include || [];
  const exclude = filter?.exclude || [];

  let filtered = result.results;
  if (include.length > 0) {
    filtered = filtered.filter((r: any) =>
      include.some((kw: string) =>
        (r.title || '').toLowerCase().includes(kw.toLowerCase()) ||
        (r.content || '').toLowerCase().includes(kw.toLowerCase())
      )
    );
  }
  if (exclude.length > 0) {
    filtered = filtered.filter((r: any) =>
      !exclude.some((kw: string) =>
        (r.title || '').toLowerCase().includes(kw.toLowerCase()) ||
        (r.content || '').toLowerCase().includes(kw.toLowerCase())
      )
    );
  }

  return { ...result, total: filtered.length, results: filtered };
}

export { searchRoute };
