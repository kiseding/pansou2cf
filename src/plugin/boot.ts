// Boot: register all config-driven plugins + dedicated plugins
import { register } from './registry';
import { pluginConfigs } from './configs';
import { configSearch } from './config-engine';

// Import dedicated plugins with custom parsing
import './pansearch';
import './yunso';
import './alupan';

let booted = false;

export function bootPlugins(): void {
  if (booted) return;
  booted = true;

  // Register config-driven plugins (skipping ones that have dedicated implementations)
  const dedicated = new Set(['pansearch', 'yunso', 'alupan']);

  for (const cfg of pluginConfigs) {
    if (dedicated.has(cfg.name)) continue;
    register({
      name: cfg.name,
      priority: cfg.priority,
      search: (keyword: string) => configSearch(cfg, keyword),
    });
  }
}
