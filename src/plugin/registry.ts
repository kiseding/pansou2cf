import type { SearchResult } from '../types';

export interface AsyncPlugin {
  name: string;
  priority: number;
  search(keyword: string): Promise<SearchResult[]>;
  skipServiceFilter?: boolean;
}

const registry = new Map<string, AsyncPlugin>();

export function register(plugin: AsyncPlugin): void {
  registry.set(plugin.name, plugin);
}

export function getAll(): AsyncPlugin[] {
  return Array.from(registry.values());
}

export function getByName(name: string): AsyncPlugin | undefined {
  return registry.get(name);
}

export function getFiltered(enabledList: string[] | null): AsyncPlugin[] {
  const all = getAll();
  if (enabledList === null) return []; // not configured
  if (enabledList.length === 0) return []; // explicitly empty
  return all.filter(p => enabledList.includes(p.name));
}
