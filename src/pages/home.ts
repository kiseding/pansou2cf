// The HTML is built procedurally to avoid template literal conflicts
export function homePage(config: any): string {
  const plugins = config.enabledPlugins || [];
  const channels = config.channels || [];
  const P = plugins.map((p: string) =>
    `<label><input type="checkbox" value="${p}" checked onchange="saveConfig()"><span>${p}</span></label>`
  ).join('');
  const C = channels.map((c: string) =>
    `<label><input type="checkbox" value="${c}" checked onchange="saveConfig()"><span>${c}</span></label>`
  ).join('');

  const css = `:root{--bg:#f8fafc;--card:#fff;--border:#e2e8f0;--text:#1e293b;--text2:#64748b;--primary:#4f46e5;--primary-hover:#4338ca;--radius:10px}[data-theme="dark"]{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--text2:#94a3b8}*{margin:0;padding:0;box-sizing:border-box}body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}nav{position:sticky;top:0;z-index:50;background:var(--card);border-bottom:1px solid var(--border);backdrop-filter:blur(8px)}nav .wrap{max-width:1100px;margin:0 auto;padding:0 16px;height:56px;display:flex;align-items:center;justify-content:space-between}nav .logo{display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:700;font-size:18px}.nav-btn{padding:6px 14px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text2);cursor:pointer;font-size:13px;transition:all .15s}.nav-btn:hover,.nav-btn.active{background:var(--primary);color:#fff;border-color:var(--primary)}main{max-width:1100px;margin:0 auto;padding:24px 16px}.card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px}.search-row{display:flex;gap:8px}.search-row input{flex:1;padding:12px 16px;border:2px solid var(--border);border-radius:8px;font-size:15px;background:var(--bg);color:var(--text);outline:none;transition:border-color .2s}.search-row input:focus{border-color:var(--primary)}.btn-primary{flex-shrink:0;padding:12px 24px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:500;cursor:pointer}.btn-primary:hover{background:var(--primary-hover)}.btn-primary:disabled{opacity:.5;cursor:not-allowed}.opts{margin-top:12px;display:none;flex-wrap:wrap;gap:8px;align-items:center}.opts label{font-size:12px;color:var(--text2)}.opts select,.opts input{padding:4px 8px;border:1px solid var(--border);border-radius:5px;font-size:12px;background:var(--bg);color:var(--text)}.opts-toggle{cursor:pointer;font-size:12px;color:var(--text2);margin-top:8px;display:inline-block}.stats{display:none;align-items:center;gap:12px;margin-bottom:12px;font-size:13px;color:var(--text2)}.stats strong{color:var(--text)}.tabs{display:none;flex-wrap:wrap;gap:4px;margin-bottom:12px}.tab{padding:6px 14px;border-radius:20px;font-size:13px;cursor:pointer;border:1px solid var(--border);background:var(--card);color:var(--text2);transition:all .15s;white-space:nowrap;user-select:none}.tab:hover{border-color:var(--primary);color:var(--primary)}.tab.active{background:var(--primary);color:#fff;border-color:var(--primary)}.result-list{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}.item{padding:12px 16px;border-bottom:1px solid var(--border)}.item:last-child{border-bottom:none}.item:hover{background:var(--bg)}.item .title{font-size:14px;font-weight:500;margin-bottom:4px;word-break:break-all}.item .link-row{display:flex;align-items:center;gap:8px;font-size:13px}.item .link-row a{color:var(--primary);text-decoration:none;word-break:break-all;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}.item .link-row a:hover{text-decoration:underline}.item .copy-btn{padding:3px 10px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text2);cursor:pointer;white-space:nowrap}.item .copy-btn:hover{background:var(--primary);color:#fff;border-color:var(--primary)}.item .meta{font-size:11px;color:var(--text2);margin-top:4px;display:flex;gap:12px}.item .pwd{font-size:12px;color:#f59e0b;margin-top:2px}.empty{text-align:center;padding:48px 16px;color:var(--text2)}.empty .icon{font-size:40px;margin-bottom:12px;opacity:.4}.loading-box{text-align:center;padding:48px 16px;color:var(--text2)}.spinner{display:inline-block;width:24px;height:24px;border:3px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite}@keyframes spin{to{transform:rotate(360deg)}}.config-card h3{font-size:16px;margin-bottom:12px}.config-card .checks{display:flex;flex-wrap:wrap;gap:8px;margin:8px 0}.config-card .checks label{display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;padding:4px 10px;border:1px solid var(--border);border-radius:6px}.config-card .checks label:hover{border-color:var(--primary)}footer{text-align:center;padding:24px;font-size:12px;color:var(--text2);border-top:1px solid var(--border)}footer a{color:var(--primary);text-decoration:none}pre.code{font-size:11px;line-height:1.6;overflow-x:auto}@media(max-width:640px){.search-row{flex-direction:column}.btn-primary{width:100%}.tabs{overflow-x:auto;flex-wrap:nowrap;padding-bottom:4px}.tab{flex-shrink:0}}`;

  return [
    '<!DOCTYPE html><html lang="zh-CN"><head>',
    '<meta charset="UTF-8"><meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">',
    '<title>PanSou - 网盘资源搜索</title>',
    '<style>', css, '</style></head><body>',
    '<nav><div class="wrap"><div class="logo" id="logoLink">🔍 PanSou</div>',
    '<div class="actions">',
    '<button class="nav-btn active" data-page="search">搜索</button>',
    '<button class="nav-btn" data-page="config">配置</button>',
    '<button class="nav-btn" data-page="docs">API</button>',
    '<button id="themeBtn" style="background:none;border:none;cursor:pointer;font-size:16px;padding:4px 8px">🌓</button>',
    '</div></div></nav><main>',
    '<div id="page-search">',
    '<div class="card"><div class="search-row">',
    '<input type="text" id="kwInput" placeholder="输入关键词搜索网盘资源..." autocomplete="off">',
    '<button class="btn-primary" id="searchBtn">搜索</button></div>',
    '<div class="opts-toggle" id="optsToggle">⚙ 高级选项</div><div class="opts" id="optsPanel">',
    '<label>来源 <select id="srcSelect"><option value="all">全部</option><option value="tg">TG频道</option><option value="plugin">插件</option></select></label>',
    '<label>网盘类型 <select id="ctSelect"><option value="">全部</option><option value="quark">夸克</option><option value="baidu">百度</option><option value="alipan">阿里</option><option value="xunlei">迅雷</option><option value="uc">UC</option><option value="123">123</option></select></label>',
    '<label>格式 <select id="resSelect"><option value="merged_by_type">按类型</option><option value="results">原始</option></select></label>',
    '</div></div>',
    '<div class="stats" id="statsBar"></div><div class="tabs" id="tabsBar"></div>',
    '<div id="resultsArea"><div class="empty"><div class="icon">🔍</div><p>输入关键词开始搜索</p><p style="font-size:12px;margin-top:4px">支持 TG频道 和 ' + plugins.length + ' 个插件</p></div></div>',
    '</div>',
    '<div id="page-config" style="display:none">',
    '<div class="card config-card"><h3>🔌 搜索插件</h3><div class="checks">' + P + '</div></div>',
    '<div class="card config-card"><h3>📡 TG 频道</h3><div class="checks">' + C + '</div></div>',
    '<div class="card config-card"><h3>⚡ 并发数: <span id="concVal">20</span></h3><input type="range" id="concRange" min="5" max="50" value="20" oninput="var e=document.getElementById(\'concVal\');e.textContent=this.value;saveConfig()" style="width:100%"></div></div>',
    '<div id="page-docs" style="display:none"><div class="card"><h3>API 接口</h3><p style="font-size:13px;color:var(--text2);line-height:1.8"><strong>GET/POST</strong> /api/search<br>参数: kw (关键词,必填) | channels | src | cloud_types | res<br>示例: <code>/api/search?kw=电影&amp;src=all&amp;cloud_types=quark</code></p></div><div class="card"><h3>响应格式</h3><pre class="code">{"code":0,"message":"success","data":{"total":100,"merged_by_type":{"quark":[{"url":"...","password":"","note":"Title"}]}}}</pre></div></div>',
    '</main>',
    '<footer>&copy; PanSou2CF · <a href="https://github.com/kiseding/pansou2cf" target="_blank">GitHub</a></footer>',
    '<script src="/ui.js"></script>',
    '</body></html>'
  ].join('');
}
