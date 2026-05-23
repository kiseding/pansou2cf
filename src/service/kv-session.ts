// KV-based session store — replaces Go's file-based cache/{plugin}_users/*.json
// Each user is stored as a KV entry: "{namespace}:user:{hash}" → JSON

export interface PluginUser {
  hash: string;
  username?: string;
  encryptedPassword?: string;   // AES-256-GCM encrypted, base64
  cookie: string;                // semicolon-delimited cookie string
  status: 'pending' | 'active';
  // Plugin-specific fields
  channels?: string[];
  channelGuildIDs?: Record<string, string>;
  userIDs?: string[];
  baseURL?: string;
  blockedPanTypes?: string[];
  qqMasked?: string;
  // Timestamps (ISO strings)
  createdAt: string;
  loginAt: string;
  expireAt: string;
  lastAccessAt: string;
}

// ── AES-256-GCM Encryption (matches Go pattern) ──

async function deriveKey(rawKey: string): Promise<CryptoKey> {
  // Use first 32 bytes of the key (matching Go: key[:32])
  const keyBytes = new TextEncoder().encode(rawKey.padEnd(32, '!').slice(0, 32));
  return crypto.subtle.importKey('raw', keyBytes, { name: 'AES-GCM' }, false, ['encrypt', 'decrypt']);
}

export async function encryptPassword(password: string, keyStr: string): Promise<string> {
  const key = await deriveKey(keyStr);
  const nonce = crypto.getRandomValues(new Uint8Array(12));
  const plaintext = new TextEncoder().encode(password);
  const ciphertext = await crypto.subtle.encrypt({ name: 'AES-GCM', iv: nonce }, key, plaintext);
  // Go format: base64(nonce || ciphertext)
  const combined = new Uint8Array(nonce.length + ciphertext.byteLength);
  combined.set(nonce);
  combined.set(new Uint8Array(ciphertext), nonce.length);
  return btoa(String.fromCharCode(...combined));
}

export async function decryptPassword(encrypted: string, keyStr: string): Promise<string> {
  const key = await deriveKey(keyStr);
  const data = Uint8Array.from(atob(encrypted), c => c.charCodeAt(0));
  const nonce = data.slice(0, 12);
  const ciphertext = data.slice(12);
  const plaintext = await crypto.subtle.decrypt({ name: 'AES-GCM', iv: nonce }, key, ciphertext);
  return new TextDecoder().decode(plaintext);
}

// ── SHA-256 Hash (for hash-based routing) ──

export async function computeHash(input: string, salt: string): Promise<string> {
  const enc = new TextEncoder();
  const data = enc.encode(input + salt);
  const hash = await crypto.subtle.digest('SHA-256', data);
  return Array.from(new Uint8Array(hash)).map(b => b.toString(16).padStart(2, '0')).join('');
}

// ── KV CRUD ──

export async function saveUser(kv: KVNamespace, namespace: string, user: PluginUser): Promise<void> {
  const key = `${namespace}:user:${user.hash}`;
  await kv.put(key, JSON.stringify(user));
}

export async function getUser(kv: KVNamespace, namespace: string, hash: string): Promise<PluginUser | null> {
  const key = `${namespace}:user:${hash}`;
  const raw = await kv.get(key);
  if (!raw) return null;
  try { return JSON.parse(raw) as PluginUser; } catch { return null; }
}

export async function deleteUser(kv: KVNamespace, namespace: string, hash: string): Promise<void> {
  const key = `${namespace}:user:${hash}`;
  await kv.delete(key);
}

export async function listUsers(kv: KVNamespace, namespace: string): Promise<PluginUser[]> {
  const prefix = `${namespace}:user:`;
  const result = await kv.list({ prefix });
  const users: PluginUser[] = [];
  for (const k of result.keys) {
    const raw = await kv.get(k.name);
    if (raw) {
      try { users.push(JSON.parse(raw)); } catch {}
    }
  }
  return users;
}

// ── Config storage ──

export async function getConfig<T>(kv: KVNamespace, namespace: string, key: string): Promise<T | null> {
  const raw = await kv.get(`${namespace}:cfg:${key}`);
  if (!raw) return null;
  try { return JSON.parse(raw) as T; } catch { return null; }
}

export async function setConfig<T>(kv: KVNamespace, namespace: string, key: string, value: T): Promise<void> {
  await kv.put(`${namespace}:cfg:${key}`, JSON.stringify(value));
}

// ── Cookie parsing ──

// Cloudflare Workers: Response headers have getSetCookie() but standard types don't declare it
export function getSetCookieHeaders(res: Response): string[] {
  const headers: string[] = [];
  // Use the Workers-specific getSetCookie() if available
  if (typeof (res.headers as any).getSetCookie === 'function') {
    return (res.headers as any).getSetCookie() as string[];
  }
  // Fallback: parse from get('set-cookie')
  const raw = res.headers.get('set-cookie');
  if (raw) {
    // Multiple Set-Cookie headers are concatenated with comma
    // Split on comma not followed by space (cookie values can have commas)
    return raw.split(/,(?=\s*\w+=)/).map(s => s.trim());
  }
  return headers;
}

export function parseCookies(setCookieHeaders: string[]): string {
  const map = new Map<string, string>();
  for (const header of setCookieHeaders) {
    const parts = header.split(';')[0].trim(); // "name=value"
    const eq = parts.indexOf('=');
    if (eq > 0) {
      map.set(parts.slice(0, eq), parts.slice(eq + 1));
    }
  }
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

export function mergeCookies(existing: string, newHeaders: string[]): string {
  const map = new Map<string, string>();
  // Parse existing
  if (existing) {
    for (const pair of existing.split(';')) {
      const [k, ...v] = pair.trim().split('=');
      if (k) map.set(k, v.join('='));
    }
  }
  // Add/replace with new
  for (const header of newHeaders) {
    const parts = header.split(';')[0].trim();
    const eq = parts.indexOf('=');
    if (eq > 0) {
      map.set(parts.slice(0, eq), parts.slice(eq + 1));
    }
  }
  return Array.from(map.entries()).map(([k, v]) => `${k}=${v}`).join('; ');
}

export function cookiesToHeader(cookieStr: string): string {
  // Remove spaces around semicolons
  return cookieStr.replace(/; /g, ';');
}

// ── User helpers ──

export function createUser(hash: string, extra: Partial<PluginUser> = {}): PluginUser {
  const now = new Date().toISOString();
  return {
    hash,
    cookie: '',
    status: 'pending',
    createdAt: now,
    loginAt: now,
    expireAt: now,
    lastAccessAt: now,
    ...extra,
  };
}

export function isUserExpired(user: PluginUser): boolean {
  return new Date(user.expireAt).getTime() < Date.now();
}
