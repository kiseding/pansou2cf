import { Hono } from 'hono';
import { checkLinks } from '../service/check';
import { successResponse, errorResponse } from '../types';

const checkRoute = new Hono();

checkRoute.post('/links', async (c) => {
  try {
    const body = await c.req.json();
    const items = body.items || [];
    const links = body.links;

    // Support both formats: {links: string[]} or {items: CheckItem[]}
    if (links && Array.isArray(links) && links.length > 0) {
      // Simple URL list — guess disk type from URL
      const items = links.map((url: string) => {
        let diskType = 'unknown';
        const u = url.toLowerCase();
        if (u.includes('pan.quark')) diskType = 'quark';
        else if (u.includes('pan.baidu')) diskType = 'baidu';
        else if (u.includes('aliyundrive') || u.includes('alipan')) diskType = 'aliyun';
        else if (u.includes('drive.uc')) diskType = 'uc';
        else if (u.includes('123pan')) diskType = '123';
        else if (u.includes('pan.xunlei')) diskType = 'xunlei';
        else if (u.includes('115.com') && (u.includes('/s/') || u.includes('?password'))) diskType = '115';
        else if (u.includes('cloud.189.cn') || u.includes('.189.cn/')) diskType = 'tianyi';
        else if (u.includes('yun.139') || u.includes('caiyun.139')) diskType = 'mobile';
        return { diskType, url };
      });
      const results = await checkLinks(items);
      return c.json(successResponse({ total: results.length, results }));
    }

    if (!items || !Array.isArray(items) || items.length === 0) {
      return c.json(errorResponse(400, '缺少 links 或 items 参数'), 400);
    }

    const results = await checkLinks(items.slice(0, 20));
    return c.json(successResponse({ total: items.length, results }));
  } catch {
    return c.json(errorResponse(400, '请求格式错误'), 400);
  }
});

export { checkRoute };
