const uiJs = `
// PanSou WebUI JavaScript
(function(){
var currentTab="search";
var searchData=null;
var activeDisk="all";

// Page switching
document.querySelectorAll(".nav-btn").forEach(function(btn){
  btn.addEventListener("click",function(){
    currentTab=this.dataset.page;
    document.querySelectorAll(".nav-btn").forEach(function(b){b.classList.toggle("active",b.dataset.page===currentTab)});
    document.querySelectorAll("[id^=page-]").forEach(function(p){p.style.display="none"});
    var pg=document.getElementById("page-"+currentTab);
    if(pg)pg.style.display="block";
  });
});

document.getElementById("logoLink").addEventListener("click",function(){
  currentTab="search";
  document.querySelectorAll(".nav-btn").forEach(function(b){b.classList.toggle("active",b.dataset.page==="search")});
  document.querySelectorAll("[id^=page-]").forEach(function(p){p.style.display="none"});
  var pg=document.getElementById("page-search");
  if(pg)pg.style.display="block";
});

// Theme
document.getElementById("themeBtn").addEventListener("click",function(){
  var b=document.body;
  var t=b.dataset.theme==="dark"?"light":"dark";
  b.dataset.theme=t;
  try{localStorage.setItem("pansou_theme",t)}catch(e){}
});
(function(){
  var t=null;
  try{t=localStorage.getItem("pansou_theme")}catch(e){}
  if(!t)t=window.matchMedia("(prefers-color-scheme:dark)").matches?"dark":"light";
  document.body.dataset.theme=t;
})();

// Advanced options
document.getElementById("optsToggle").addEventListener("click",function(){
  var p=document.getElementById("optsPanel");
  p.style.display=p.style.display==="flex"?"none":"flex";
});

// Search
document.getElementById("searchBtn").addEventListener("click",doSearch);
document.getElementById("kwInput").addEventListener("keydown",function(e){if(e.key==="Enter")doSearch()});

function doSearch(){
  var kw=document.getElementById("kwInput").value.trim();
  if(!kw)return;
  var btn=document.getElementById("searchBtn");
  btn.disabled=true;btn.textContent="搜索中...";
  document.getElementById("resultsArea").innerHTML='<div class="loading-box"><div class="spinner"></div><p style="margin-top:12px">搜索中...</p></div>';
  document.getElementById("statsBar").style.display="none";
  document.getElementById("tabsBar").style.display="none";

  var p=new URLSearchParams();p.set("kw",kw);
  var src=document.getElementById("srcSelect").value;if(src!=="all")p.set("src",src);
  var ct=document.getElementById("ctSelect").value;if(ct)p.set("cloud_types",ct);
  p.set("res",document.getElementById("resSelect").value);

  var startTime=Date.now();
  fetch("/api/search?"+p.toString()).then(function(r){return r.json()}).then(function(d){
    var data=d.data||d;
    searchData=data;
    var time=Date.now()-startTime;
    showResults(data,time);
    btn.disabled=false;btn.textContent="搜索";
  }).catch(function(e){
    document.getElementById("resultsArea").innerHTML='<div class="empty"><div class="icon">❌</div><p>请求失败: '+e.message+'</p></div>';
    btn.disabled=false;btn.textContent="搜索";
  });
}

function showResults(data,time){
  if(!data||!data.total||data.total===0){
    document.getElementById("resultsArea").innerHTML='<div class="empty"><div class="icon">📭</div><p>未找到结果</p></div>';return;
  }
  var merged=data.merged_by_type||{};
  var types=Object.keys(merged).sort(function(a,b){return merged[b].length-merged[a].length});
  if(!types.length){document.getElementById("resultsArea").innerHTML='<div class="empty"><div class="icon">📭</div><p>未找到结果</p></div>';return}

  document.getElementById("statsBar").style.display="flex";
  document.getElementById("statsBar").innerHTML='<span>共 <strong>'+data.total+'</strong> 条</span><span>耗时 <strong>'+(time/1000).toFixed(1)+'s</strong></span>';
  document.getElementById("tabsBar").style.display="flex";

  activeDisk="all";
  var tabsHtml='<div class="tab active" data-type="all">全部</div>';
  for(var i=0;i<types.length;i++){
    var t=types[i];
    tabsHtml+='<div class="tab" data-type="'+t+'">'+typeName(t)+' ('+merged[t].length+')</div>';
  }
  document.getElementById("tabsBar").innerHTML=tabsHtml;

  document.querySelectorAll("#tabsBar .tab").forEach(function(el){
    el.addEventListener("click",function(){
      activeDisk=this.dataset.type;
      document.querySelectorAll("#tabsBar .tab").forEach(function(tab){tab.classList.toggle("active",tab.dataset.type===activeDisk)});
      renderList(merged,types);
    });
  });

  renderList(merged,types);
}

function renderList(merged,types){
  var items=[];
  if(activeDisk==="all"){
    for(var i=0;i<types.length;i++){
      var t=types[i];
      var arr=merged[t]||[];
      for(var j=0;j<arr.length;j++){
        items.push({disk:t,url:arr[j].url||"",password:arr[j].password||"",title:arr[j].note||arr[j].title||"无标题",source:arr[j].source||"",datetime:(arr[j].datetime||"").slice(0,16)});
      }
    }
  }else{
    var arr=merged[activeDisk]||[];
    for(var j=0;j<arr.length;j++){
      items.push({disk:activeDisk,url:arr[j].url||"",password:arr[j].password||"",title:arr[j].note||arr[j].title||"无标题",source:arr[j].source||"",datetime:(arr[j].datetime||"").slice(0,16)});
    }
  }

  var html='<div class="result-list">';
  for(var i=0;i<items.length;i++){
    var it=items[i];
    html+='<div class="item">';
    html+='<div class="title">'+esc(it.title)+'</div>';
    html+='<div class="link-row"><a href="'+escAttr(it.url)+'" target="_blank" rel="noopener">'+esc(it.url)+'</a><button class="copy-btn" data-url="'+escAttr(it.url)+'">复制</button></div>';
    if(it.password)html+='<div class="pwd">🔑 提取码: '+esc(it.password)+'</div>';
    html+='<div class="meta"><span>'+typeName(it.disk)+'</span><span>'+esc(it.source)+'</span><span>'+it.datetime+'</span></div>';
    html+='</div>';
  }
  html+='</div>';
  document.getElementById("resultsArea").innerHTML=html;

  document.querySelectorAll("#resultsArea .copy-btn").forEach(function(btn){
    btn.addEventListener("click",function(){
      var url=this.dataset.url;
      if(navigator.clipboard&&navigator.clipboard.writeText){
        navigator.clipboard.writeText(url).then(function(){
          btn.textContent="已复制";btn.style.background="#22c55e";btn.style.color="#fff";
          setTimeout(function(){btn.textContent="复制";btn.style.background="";btn.style.color=""},1500);
        }).catch(function(){fallbackCopy(url,btn)});
      }else{fallbackCopy(url,btn)}
    });
  });
}

function fallbackCopy(url,btn){
  var ta=document.createElement("textarea");
  ta.value=url;ta.style.position="fixed";ta.style.left="-9999px";
  document.body.appendChild(ta);ta.select();
  try{document.execCommand("copy")}catch(e){}
  document.body.removeChild(ta);
  btn.textContent="已复制";btn.style.background="#22c55e";btn.style.color="#fff";
  setTimeout(function(){btn.textContent="复制";btn.style.background="";btn.style.color=""},1500);
}

function typeName(t){
  var m={quark:"夸克",baidu:"百度",alipan:"阿里云盘",aliyun:"阿里",xunlei:"迅雷",uc:"UC","123":"123云盘",tianyi:"天翼",mobile:"中国移动",pikpak:"PikPak"};
  return m[t]||t;
}

function esc(s){return String(s||"").replace(/&/g,"&amp;").replace(/</g,"&lt;").replace(/>/g,"&gt;").replace(/"/g,"&quot;")}
function escAttr(s){return String(s||"").replace(/&/g,"&amp;").replace(/"/g,"&quot;")}

window.saveConfig=function(){
  try{
    var plugins=[];document.querySelectorAll("#pluginChecks input:checked").forEach(function(e){plugins.push(e.value)});
    localStorage.setItem("pansou_plugins",JSON.stringify(plugins));
    var channels=[];document.querySelectorAll("#channelChecks input:checked").forEach(function(e){channels.push(e.value)});
    localStorage.setItem("pansou_channels",JSON.stringify(channels));
    localStorage.setItem("pansou_conc",document.getElementById("concRange").value);
  }catch(e){}
};

(function loadConfig(){
  try{
    var sp=localStorage.getItem("pansou_plugins");
    if(sp){var ap=JSON.parse(sp);document.querySelectorAll("#pluginChecks input").forEach(function(e){e.checked=ap.includes(e.value)})}
    var sc=localStorage.getItem("pansou_channels");
    if(sc){var ac=JSON.parse(sc);document.querySelectorAll("#channelChecks input").forEach(function(e){e.checked=ac.includes(e.value)})}
    var cn=localStorage.getItem("pansou_conc");
    if(cn){document.getElementById("concRange").value=cn;document.getElementById("concVal").textContent=cn}
  }catch(e){}
})();
})();
`; export default uiJs;
