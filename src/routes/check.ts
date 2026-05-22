import { Hono } from 'hono';
import { successResponse, errorResponse } from '../types';

const checkRoute = new Hono();

checkRoute.post('/links', async (c) => {
  try {
    const body = await c.req.json();
    const links: string[] = body.links || [];
    if (!links.length) return c.json(errorResponse(400, '缺少links参数'), 400);

    const results = await Promise.allSettled(
      links.slice(0, 20).map(async (url) => {
        try {
          const res = await fetch(url, {
            method: 'HEAD',
            headers: { 'User-Agent': 'Mozilla/5.0' },
          });
          return { url, status: res.status, ok: res.ok };
        } catch (e: any) {
          return { url, status: 0, ok: false, error: e?.message };
        }
      })
    );

    return c.json(successResponse({
      total: links.length,
      results: results.map((r, i) =>
        r.status === 'fulfilled' ? r.value : { url: links[i], status: 0, ok: false, error: '请求失败' }
      ),
    }));
  } catch {
    return c.json(errorResponse(400, '请求格式错误'), 400);
  }
});

export { checkRoute };
