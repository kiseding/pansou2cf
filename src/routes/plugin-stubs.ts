// Plugin account management route stubs
// These endpoints exist so the Vue frontend doesn't break, but the full
// account management features (QR login, session persistence) require
// a stateful backend that Cloudflare Workers can't provide without KV/D1.

import { Hono } from 'hono';

async function sha256(text: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(text);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

const UNAVAILABLE_MSG = '账号管理功能在 Cloudflare Workers 上暂不可用。请使用开源 Go 版部署完整后端。';

export function pluginStubRoute(name: string): Hono {
  const r = new Hono();

  // POST /:hash — handle actions
  r.post('/:hash', async (c) => {
    try {
      const body = await c.req.json();
      const action = body.action || '';

      switch (action) {
        case 'get_status':
          return c.json({
            logged_in: false,
            message: UNAVAILABLE_MSG,
            qrcode: '',
            channels: [],
            user_ids: [],
            base_url: '',
            blocked_pan_types: [],
          });
        case 'get_config':
          return c.json({ base_url: '', message: UNAVAILABLE_MSG });
        case 'update_config':
        case 'set_channels':
        case 'set_user_ids':
          return c.json({ message: UNAVAILABLE_MSG });
        case 'refresh_qrcode':
          return c.json({ qrcode: '', message: UNAVAILABLE_MSG });
        case 'check_login':
          return c.json({ logged_in: false, message: '' });
        case 'login':
          return c.json({ success: false, message: UNAVAILABLE_MSG });
        case 'logout':
          return c.json({ message: 'ok' });
        case 'test_search':
          return c.json({ results: [], total: 0, message: UNAVAILABLE_MSG });
        default:
          return c.json({ message: UNAVAILABLE_MSG });
      }
    } catch {
      return c.json({ message: UNAVAILABLE_MSG });
    }
  });

  // GET /:param — redirect to hash URL or return hash
  r.get('/:param', async (c) => {
    const param = c.req.param('param');
    const hash = await sha256(name + ':' + param);
    return c.redirect(`/${name}/${hash}`);
  });

  return r;
}
