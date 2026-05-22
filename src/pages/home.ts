export function homePage(config: any): string {
  const plugins = config.enabledPlugins || [];
  const channels = config.channels || [];
  return `<!DOCTYPE html>
<html lang="zh-CN">
<head>
<meta charset="UTF-8">
<meta name="viewport" content="width=device-width,initial-scale=1.0,maximum-scale=1.0,user-scalable=no">
<title>PanSou - 网盘资源搜索</title>
<style>
:root{--bg:#f8fafc;--card:#fff;--border:#e2e8f0;--text:#1e293b;--text2:#64748b;--primary:#4f46e5;--primary-hover:#4338ca;--danger:#ef4444;--radius:10px}
[data-theme=dark]{--bg:#0f172a;--card:#1e293b;--border:#334155;--text:#e2e8f0;--text2:#94a3b8}
*{margin:0;padding:0;box-sizing:border-box}
body{font-family:-apple-system,BlinkMacSystemFont,"Segoe UI",Roboto,sans-serif;background:var(--bg);color:var(--text);min-height:100vh}
nav{position:sticky;top:0;z-index:50;background:var(--card);border-bottom:1px solid var(--border);backdrop-filter:blur(8px)}
nav .wrap{max-width:1100px;margin:0 auto;padding:0 16px;height:56px;display:flex;align-items:center;justify-content:space-between}
nav .logo{display:flex;align-items:center;gap:8px;cursor:pointer;font-weight:700;font-size:18px}
nav .logo svg{width:24px;height:24px;color:var(--primary)}
nav .actions{display:flex;align-items:center;gap:8px}
nav .actions button{padding:6px 14px;border:1px solid var(--border);border-radius:6px;background:var(--card);color:var(--text2);cursor:pointer;font-size:13px;transition:all .15s}
nav .actions button:hover,.nav-btn.active{background:var(--primary);color:#fff;border-color:var(--primary)}
main{max-width:1100px;margin:0 auto;padding:24px 16px}
.search-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px}
.search-card .row{display:flex;gap:8px}
.search-card input{flex:1;padding:12px 16px;border:2px solid var(--border);border-radius:8px;font-size:15px;background:var(--bg);color:var(--text);outline:none;transition:border-color .2s}
.search-card input:focus{border-color:var(--primary)}
.search-card .btn{flex-shrink:0;padding:12px 24px;background:var(--primary);color:#fff;border:none;border-radius:8px;font-size:15px;font-weight:500;cursor:pointer;transition:background .15s}
.search-card .btn:hover{background:var(--primary-hover)}
.search-card .btn:disabled{opacity:.5;cursor:not-allowed}
.opts{margin-top:12px;display:flex;flex-wrap:wrap;gap:6px;align-items:center}
.opts label{font-size:12px;color:var(--text2)}
.opts select,.opts input{padding:4px 8px;border:1px solid var(--border);border-radius:5px;font-size:12px;background:var(--bg);color:var(--text)}
.stats{display:flex;align-items:center;gap:12px;margin-bottom:12px;font-size:13px;color:var(--text2)}
.stats strong{color:var(--text)}
.tabs{display:flex;flex-wrap:wrap;gap:4px;margin-bottom:12px}
.tab{padding:6px 14px;border-radius:20px;font-size:13px;cursor:pointer;border:1px solid var(--border);background:var(--card);color:var(--text2);transition:all .15s;white-space:nowrap}
.tab:hover{border-color:var(--primary);color:var(--primary)}
.tab.active{background:var(--primary);color:#fff;border-color:var(--primary)}
.result-list{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);overflow:hidden}
.result-item{padding:12px 16px;border-bottom:1px solid var(--border);transition:background .1s}
.result-item:last-child{border-bottom:none}
.result-item:hover{background:var(--bg)}
.result-item .title{font-size:14px;font-weight:500;margin-bottom:4px;word-break:break-all}
.result-item .link-row{display:flex;align-items:center;gap:8px;font-size:13px}
.result-item .link-row a{color:var(--primary);text-decoration:none;word-break:break-all;flex:1;min-width:0;overflow:hidden;text-overflow:ellipsis;white-space:nowrap}
.result-item .link-row a:hover{text-decoration:underline}
.result-item .link-row .copy-btn{padding:3px 10px;font-size:11px;border:1px solid var(--border);border-radius:4px;background:var(--bg);color:var(--text2);cursor:pointer;white-space:nowrap;transition:all .1s}
.result-item .link-row .copy-btn:hover{background:var(--primary);color:#fff;border-color:var(--primary)}
.result-item .meta{font-size:11px;color:var(--text2);margin-top:4px;display:flex;gap:12px}
.result-item .pwd{font-size:12px;color:#f59e0b;margin-top:2px}
.empty{text-align:center;padding:48px 16px;color:var(--text2)}
.empty svg{width:48px;height:48px;margin-bottom:12px;opacity:.4}
.loading{text-align:center;padding:48px 16px;color:var(--text2)}
.spinner{display:inline-block;width:24px;height:24px;border:3px solid var(--border);border-top-color:var(--primary);border-radius:50%;animation:spin .8s linear infinite}
@keyframes spin{to{transform:rotate(360deg)}}
.config-card{background:var(--card);border:1px solid var(--border);border-radius:var(--radius);padding:20px;margin-bottom:16px}
.config-card h3{font-size:16px;margin-bottom:12px;display:flex;align-items:center;gap:8px}
.config-card .checks{display:flex;flex-wrap:wrap;gap:8px}
.config-card .checks label{display:flex;align-items:center;gap:4px;font-size:13px;cursor:pointer;padding:4px 10px;border:1px solid var(--border);border-radius:6px;transition:all .15s}
.config-card .checks label:hover{border-color:var(--primary)}
.config-card .checks input:checked+span{color:var(--primary)}
.btn-sm{padding:8px 16px;border:1px solid var(--primary);border-radius:6px;background:var(--primary);color:#fff;font-size:13px;cursor:pointer;margin-top:12px}
footer{text-align:center;padding:24px;font-size:12px;color:var(--text2);border-top:1px solid var(--border)}
footer a{color:var(--primary);text-decoration:none}
@media(max-width:640px){
  nav .actions .nav-btn{font-size:11px;padding:4px 8px}
  .search-card .row{flex-direction:column}
  .search-card .btn{width:100%}
  .tabs{overflow-x:auto;flex-wrap:nowrap;padding-bottom:4px}
  .tab{flex-shrink:0}
}
</style>
</head>
<body data-theme="light">
<nav>
  <div class="wrap">
    <div class="logo" onclick="switchTab('search')">
      <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="2" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
      PanSou
    </div>
    <div class="actions">
      <button class="nav-btn active" onclick="switchTab('search')">搜索</button>
      <button class="nav-btn" onclick="switchTab('config')">配置</button>
      <button class="nav-btn" onclick="switchTab('docs')">API</button>
      <button onclick="toggleTheme()" style="font-size:16px;background:none;border:none;cursor:pointer;padding:4px 8px">🌓</button>
    </div>
  </div>
</nav>
<main>
  <!-- SEARCH PAGE -->
  <div id="page-search">
    <div class="search-card">
      <div class="row">
        <input type="text" id="kw" placeholder="输入关键词搜索网盘资源..." autofocus autocomplete="off">
        <button class="btn" id="searchBtn" onclick="doSearch()">搜索</button>
      </div>
      <div class="opts" id="advancedOpts" style="display:none">
        <label>来源</label>
        <select id="src"><option value="all">全部</option><option value="tg">TG频道</option><option value="plugin">插件</option></select>
        <label>类型</label>
        <select id="cloud_types"><option value="">全部</option><option value="quark">夸克</option><option value="baidu">百度</option><option value="alipan">阿里</option><option value="xunlei">迅雷</option><option value="uc">UC</option><option value="123">123</option></select>
        <label>结果</label>
        <select id="res"><option value="merged_by_type">按类型分组</option><option value="results">原始结果</option></select>
      </div>
      <div style="margin-top:8px;cursor:pointer;font-size:12px;color:var(--text2)" onclick="document.getElementById('advancedOpts').style.display=document.getElementById('advancedOpts').style.display==='none'?'flex':'none'">⚙ 高级选项</div>
    </div>

    <div id="statsBar" class="stats" style="display:none"></div>
    <div id="tabsBar" class="tabs" style="display:none"></div>
    <div id="resultsArea">
      <div class="empty">
        <svg fill="none" stroke="currentColor" viewBox="0 0 24 24"><path stroke-linecap="round" stroke-linejoin="round" stroke-width="1.5" d="M21 21l-6-6m2-5a7 7 0 11-14 0 7 7 0 0114 0z"/></svg>
        <p>输入关键词开始搜索</p>
        <p style="font-size:12px;margin-top:4px">支持 TG频道 和 ${plugins.length} 个插件</p>
      </div>
    </div>
  </div>

  <!-- CONFIG PAGE -->
  <div id="page-config" style="display:none">
    <div class="config-card">
      <h3>🔌 搜索插件</h3>
      <div class="checks" id="pluginChecks">
        ${plugins.map((p: string) => '<label><input type="checkbox" value="'+p+'" checked onchange="saveConfig()"><span>'+p+'</span></label>').join('')}
      </div>
    </div>
    <div class="config-card">
      <h3>📡 TG 频道</h3>
      <div class="checks" id="channelChecks">
        ${channels.map((c: string) => '<label><input type="checkbox" value="'+c+'" checked onchange="saveConfig()"><span>'+c+'</span></label>').join('')}
      </div>
    </div>
    <div class="config-card">
      <h3>⚡ 并发数</h3>
      <input type="range" id="concRange" min="5" max="50" value="20" oninput="document.getElementById('concVal').textContent=this.value;saveConfig()" style="width:100%">
      <span id="concVal" style="font-size:14px">20</span>
    </div>
  </div>

  <!-- DOCS PAGE -->
  <div id="page-docs" style="display:none">
    <div class="config-card">
      <h3>API 接口</h3>
      <p style="font-size:13px;color:var(--text2);line-height:1.8">
        <strong>GET/POST</strong> /api/search<br>
        参数: kw (关键词, 必填) | channels | src | cloud_types | res<br>
        示例: <code>/api/search?kw=电影&src=all&cloud_types=quark</code>
      </p>
    </div>
    <div class="config-card">
      <h3>响应格式</h3>
      <pre style="font-size:11px;line-height:1.6;overflow-x:auto">{
  "code": 0,
  "message": "success",
  "data": {
    "total": 100,
    "merged_by_type": {
      "quark": [{"url":"...","password":"","note":"标题","datetime":""}]
    }
  }
}</pre>
    </div>
  </div>
</main>
<footer>&copy; PanSou2CF &middot; <a href="https://github.com/kiseding/pansou2cf" target="_blank">GitHub</a></footer>

<script>
let currentTab='search';
let searchData=null;
let activeDiskType='all';

function switchTab(t){
  currentTab=t;
  document.querySelectorAll('[id^=page-]').forEach(e=>e.style.display='none');
  document.getElementById('page-'+t).style.display='block';
  document.querySelectorAll('.nav-btn').forEach((b,i)=>{
    b.classList.toggle('active',(i===0&&t==='search')||(i===1&&t==='config')||(i===2&&t==='docs'));
  });
}

function toggleTheme(){
  const b=document.body;
  b.dataset.theme=b.dataset.theme==='dark'?'light':'dark';
  localStorage.setItem('theme',b.dataset.theme);
}
(function(){document.body.dataset.theme=localStorage.getItem('theme')||(window.matchMedia('(prefers-color-scheme:dark)').matches?'dark':'light');})();

async function doSearch(){
  const kw=document.getElementById('kw').value.trim();
  if(!kw)return;
  const btn=document.getElementById('searchBtn');
  btn.disabled=true;btn.textContent='搜索中...';
  document.getElementById('resultsArea').innerHTML='<div class="loading"><div class="spinner"></div><p style="margin-top:12px">搜索中...</p></div>';
  document.getElementById('statsBar').style.display='none';
  document.getElementById('tabsBar').style.display='none';

  const params=new URLSearchParams({kw});
  const src=document.getElementById('src').value;
  if(src!=='all')params.set('src',src);
  const ct=document.getElementById('cloud_types').value;
  if(ct)params.set('cloud_types',ct);
  params.set('res',document.getElementById('res').value);

  const start=Date.now();
  try{
    const r=await fetch('/api/search?'+params.toString());
    const d=await r.json();
    searchData=d.data||d;
    renderResults(searchData,Date.now()-start);
  }catch(e){
    document.getElementById('resultsArea').innerHTML='<div class="empty"><p>请求失败: '+e.message+'</p></div>';
  }
  btn.disabled=false;btn.textContent='搜索';
}

function renderResults(data,time){
  if(!data||!data.total){
    document.getElementById('resultsArea').innerHTML='<div class="empty"><p>未找到结果</p></div>';
    return;
  }
  document.getElementById('statsBar').style.display='flex';
  document.getElementById('statsBar').innerHTML='<span>共 <strong>'+data.total+'</strong> 条</span><span>耗时 <strong>'+(time/1000).toFixed(1)+'s</strong></span>';
  document.getElementById('tabsBar').style.display='flex';

  const merged=data.merged_by_type||{};
  const types=Object.keys(merged).sort((a,b)=>merged[b].length-merged[a].length);
  if(!types.length){document.getElementById('resultsArea').innerHTML='<div class="empty"><p>未找到结果</p></div>';return}

  let tabsHtml='<div class="tab'+(activeDiskType==='all'?' active':'')+'" onclick="switchDisk(\'all\')">全部</div>';
  for(const t of types)tabsHtml+='<div class="tab'+(activeDiskType===t?' active':'')+'" onclick="switchDisk(\''+t+'\')">'+typeName(t)+' ('+merged[t].length+')</div>';
  document.getElementById('tabsBar').innerHTML=tabsHtml;

  renderDiskResults(merged,types);
}

function renderDiskResults(merged,types){
  let html='';
  const items=activeDiskType==='all'
    ?types.flatMap(t=>merged[t].map(i=>({...i,_disk:t})))
    :(merged[activeDiskType]||[]).map(i=>({...i,_disk:activeDiskType}));

  html+='<div class="result-list">';
  for(const item of items){
    const url=item.url||'';
    const pw=item.password||'';
    html+='<div class="result-item">';
    html+='<div class="title">'+(item.note||item.title||'无标题')+'</div>';
    html+='<div class="link-row"><a href="'+escapeHtml(url)+'" target="_blank" rel="noopener">'+escapeHtml(url)+'</a><button class="copy-btn" onclick="copyUrl(\''+escapeAttr(url)+'\',this)">复制</button></div>';
    if(pw)html+='<div class="pwd">🔑 提取码: '+escapeHtml(pw)+'</div>';
    html+='<div class="meta"><span>'+typeName(item._disk)+'</span><span>'+(item.source||'')+'</span><span>'+(item.datetime||'').slice(0,16)+'</span></div>';
    html+='</div>';
  }
  html+='</div>';
  document.getElementById('resultsArea').innerHTML=html;
}

function switchDisk(type){
  activeDiskType=type;
  if(searchData)renderResults(searchData,0);
}

function copyUrl(url,btn){
  navigator.clipboard.writeText(url).then(()=>{
    btn.textContent='已复制';btn.style.background='#22c55e';btn.style.color='#fff';
    setTimeout(()=>{btn.textContent='复制';btn.style.background='';btn.style.color=''},1500);
  }).catch(()=>{
    const ta=document.createElement('textarea');ta.value=url;document.body.appendChild(ta);ta.select();document.execCommand('copy');document.body.removeChild(ta);
    btn.textContent='已复制';
    setTimeout(()=>{btn.textContent='复制'},1500);
  });
}

function typeName(t){
  const m={quark:'夸克',baidu:'百度',alipan:'阿里云盘',aliyun:'阿里',xunlei:'迅雷',uc:'UC',123:'123云盘',tianyi:'天翼',mobile:'中国移动',pikpak:'PikPak'};
  return m[t]||t;
}

function escapeHtml(s){return String(s).replace(/&/g,'&amp;').replace(/</g,'&lt;').replace(/>/g,'&gt;').replace(/"/g,'&quot;')}
function escapeAttr(s){return String(s).replace(/'/g,'&#39;').replace(/"/g,'&quot;')}

function saveConfig(){
  const plugins=Array.from(document.querySelectorAll('#pluginChecks input:checked')).map(e=>e.value);
  const channels=Array.from(document.querySelectorAll('#channelChecks input:checked')).map(e=>e.value);
  const conc=document.getElementById('concRange').value;
  localStorage.setItem('pansou_plugins',JSON.stringify(plugins));
  localStorage.setItem('pansou_channels',JSON.stringify(channels));
  localStorage.setItem('pansou_conc',conc);
}

(function loadConfig(){
  try{
    const savedPlugins=JSON.parse(localStorage.getItem('pansou_plugins'));
    if(savedPlugins){
      document.querySelectorAll('#pluginChecks input').forEach(e=>{e.checked=savedPlugins.includes(e.value)});
    }
    const savedChannels=JSON.parse(localStorage.getItem('pansou_channels'));
    if(savedChannels){
      document.querySelectorAll('#channelChecks input').forEach(e=>{e.checked=savedChannels.includes(e.value)});
    }
    const savedConc=localStorage.getItem('pansou_conc');
    if(savedConc){document.getElementById('concRange').value=savedConc;document.getElementById('concVal').textContent=savedConc;}
  }catch(e){}
})();

document.getElementById('kw').addEventListener('keydown',e=>{if(e.key==='Enter')doSearch();});
</script>
</body>
</html>`;
}
