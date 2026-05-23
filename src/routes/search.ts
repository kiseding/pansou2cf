import { Hono } from 'hono';
import type { SearchRequest } from '../types';
import { search } from '../service/search';
import { successResponse, errorResponse } from '../types';

const searchRoute = new Hono();

searchRoute.get('/', async (c) => {
  const req = parseSearchParams(c.req.query());
  if (!req.kw) return c.json(errorResponse(400, '缺少搜索关键词(kw)'), 400);
  return handleSearch(req, c);
});

searchRoute.post('/', async (c) => {
  try {
    const body = await c.req.json();
    const req = parseSearchBody(body);
    if (!req.kw) return c.json(errorResponse(400, '缺少搜索关键词(kw)'), 400);
    return handleSearch(req, c);
  } catch {
    return c.json(errorResponse(400, '请求格式错误'), 400);
  }
});

async function handleSearch(req: SearchRequest, c: any): Promise<Response> {
  const accept = c.req.header('Accept') || '';

  if (accept.includes('text/event-stream')) {
    // SSE streaming mode
    const stream = await search(req, c.env, true) as ReadableStream;
    return new Response(stream, {
      headers: {
        'Content-Type': 'text/event-stream',
        'Cache-Control': `max-age=${30}`,
        'Connection': 'keep-alive',
        'X-Accel-Buffering': 'no',
      },
    });
  }

  // Standard JSON mode
  try {
    const result = await search(req, c.env, false) as any;
    if (req.filter) applyFilter(result, req.filter);
    return c.json(successResponse(result));
  } catch (e: any) {
    return c.json(errorResponse(500, '搜索失败: ' + (e?.message || '未知错误')), 500);
  }
}

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
    filtered = filtered.filter((r: any) => include.some((kw: string) => (r.title || '').toLowerCase().includes(kw.toLowerCase()) || (r.content || '').toLowerCase().includes(kw.toLowerCase())));
  }
  if (exclude.length > 0) {
    filtered = filtered.filter((r: any) => !exclude.some((kw: string) => (r.title || '').toLowerCase().includes(kw.toLowerCase()) || (r.content || '').toLowerCase().includes(kw.toLowerCase())));
  }
  return { ...result, total: filtered.length, results: filtered };
}

export { searchRoute };
