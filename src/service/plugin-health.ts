// Plugin health tracking — maintains quality metrics per plugin across requests.
// Failed plugins get demoted to lower tiers and eventually circuit-broken.

export interface PluginHealth {
  name: string;
  successRate: number;       // 0.0 - 1.0
  avgLatencyMs: number;
  timeoutCount: number;
  consecutiveFails: number;
  lastSuccessAt: number;     // timestamp ms
  totalAttempts: number;
  totalSuccesses: number;
}

// Memory cache (reset on cold start). Also persists to KV if available.
const healthMap = new Map<string, PluginHealth>();
const CIRCUIT_BREAK_MS = 300_000; // 5 minutes
const MAX_CONSECUTIVE_FAILS = 5;

function getDefaultHealth(name: string): PluginHealth {
  return {
    name,
    successRate: 1.0,       // Assume good until proven otherwise
    avgLatencyMs: 2000,
    timeoutCount: 0,
    consecutiveFails: 0,
    lastSuccessAt: Date.now(),
    totalAttempts: 0,
    totalSuccesses: 0,
  };
}

export function getHealth(name: string): PluginHealth {
  if (!healthMap.has(name)) healthMap.set(name, getDefaultHealth(name));
  return healthMap.get(name)!;
}

export function recordSuccess(name: string, latencyMs: number): void {
  const h = getHealth(name);
  h.totalAttempts++;
  h.totalSuccesses++;
  h.consecutiveFails = 0;
  h.lastSuccessAt = Date.now();
  h.successRate = h.totalSuccesses / Math.max(h.totalAttempts, 1);
  h.avgLatencyMs = (h.avgLatencyMs * 0.7) + (latencyMs * 0.3); // EMA
  healthMap.set(name, h);
}

export function recordFailure(name: string, timedOut: boolean): void {
  const h = getHealth(name);
  h.totalAttempts++;
  h.consecutiveFails++;
  if (timedOut) h.timeoutCount++;
  h.successRate = h.totalSuccesses / Math.max(h.totalAttempts, 1);
  healthMap.set(name, h);
}

export function isCircuitBroken(name: string): boolean {
  const h = getHealth(name);
  if (h.consecutiveFails >= MAX_CONSECUTIVE_FAILS) {
    const sinceLastSuccess = Date.now() - h.lastSuccessAt;
    if (sinceLastSuccess < CIRCUIT_BREAK_MS) return true;
    // Reset circuit breaker after cooldown
    h.consecutiveFails = 0;
    healthMap.set(name, h);
  }
  return false;
}

// Tier assignment:
// 1: high success rate + fast
// 2: moderate
// 3: slow or unreliable
export function getTier(name: string): 1 | 2 | 3 {
  const h = getHealth(name);
  if (isCircuitBroken(name)) return 3;
  if (h.successRate >= 0.5 && h.avgLatencyMs < 5000) return 1;
  if (h.successRate >= 0.2) return 2;
  return 3;
}

export function getPriority(name: string): number {
  const h = getHealth(name);
  if (isCircuitBroken(name)) return 999; // lowest priority
  const tier = getTier(name);
  // Lower = higher priority. Within tier, sort by success rate and speed.
  return (tier * 100) + (h.avgLatencyMs / 100);
}

// Persist to KV when available
export async function loadFromKV(kv: KVNamespace): Promise<void> {
  try {
    const raw = await kv.get('plugin:health');
    if (raw) {
      const data = JSON.parse(raw) as Record<string, PluginHealth>;
      for (const [name, h] of Object.entries(data)) {
        healthMap.set(name, h);
      }
    }
  } catch {}
}

export async function saveToKV(kv: KVNamespace): Promise<void> {
  try {
    const data: Record<string, PluginHealth> = {};
    for (const [name, h] of healthMap) data[name] = h;
    await kv.put('plugin:health', JSON.stringify(data), { expirationTtl: 86400 });
  } catch {}
}
