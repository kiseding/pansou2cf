// Plugin configurations — real URLs extracted from Go source code
import type { PluginConfig } from './config-engine';

export const pluginConfigs: PluginConfig[] = [
  // === Priority 1 ===
  { name: 'pansearch', priority: 1, searchUrl: 'https://www.pansearch.me/search?keyword={keyword}' },

  // === Priority 3 ===
  { name: 'yunso', priority: 3, searchUrl: 'https://www.yunso.net/index/user/s?kw={keyword}', mode: 'html' },
  { name: 'alupan', priority: 3, searchUrl: 'https://www.alupan.net/search?keyword={keyword}', mode: 'html' },

  // === JSON API plugins (verified from Go source) ===
  {
    name: 'haisou', priority: 3, mode: 'json', jsonResultPath: 'data',
    searchUrl: 'https://haisou.cc/api/pan/share/search?query={keyword}&scope=title&page=1&filter_valid=true&filter_has_files=false',
  },
  {
    name: 'jupansou', priority: 4, mode: 'json', jsonResultPath: 'data.items',
    searchUrl: 'https://pan.dyuzi.com/api/other/web_search?title={keyword}&is_type=all&is_show=1&skip_check=1&max=120',
  },
  {
    name: 'sousou', priority: 3, mode: 'json',
    searchUrl: 'https://sousou.pro/api.php?keyword={keyword}',
  },
  {
    name: 'mikuclub', priority: 5, mode: 'json', jsonResultPath: 'posts',
    searchUrl: 'https://www.mikuclub.uk/wp-json/utils/v2/post_list?search={keyword}',
  },
  {
    name: 'miaoso', priority: 4, mode: 'json', jsonResultPath: 'data',
    searchUrl: 'https://miaosou.fun/info?searchKey={keyword}',
  },
  {
    name: 'sdso', priority: 4, mode: 'json', jsonResultPath: 'data',
    searchUrl: 'https://sdso.top/api/sd/search?name={keyword}&pageNo=1',
  },
  {
    name: 'pan666', priority: 4, mode: 'json',
    searchUrl: 'https://pan666.net/api/discussions?q={keyword}',
  },
  {
    name: 'cyg', priority: 5, mode: 'json', jsonFields: { title: 'title.rendered', url: 'link', datetime: 'date' },
    searchUrl: 'https://cyg.app/wp-json/wp/v2/posts?per_page=30&orderby=date&order=desc&page=1&search={keyword}',
  },
  {
    name: 'ouge', priority: 4, mode: 'json', jsonResultPath: 'list',
    searchUrl: 'https://woog.nxog.eu.org/api.php/provide/vod?ac=detail&wd={keyword}',
  },
  {
    name: 'wanou', priority: 4, mode: 'json', jsonResultPath: 'list',
    searchUrl: 'https://woog.nxog.eu.org/api.php/provide/vod?ac=detail&wd={keyword}',
  },
  {
    name: 'feikuai', priority: 4, mode: 'json', jsonResultPath: 'data',
    searchUrl: 'https://feikuai.tv/t_search/bm_search.php?kw={keyword}',
  },
  {
    name: 'jsnoteclub', priority: 5, mode: 'json', jsonResultPath: 'posts',
    searchUrl: 'https://jsnoteclub.com/ghost/api/content/posts/?search={keyword}',
  },
  {
    name: 'bixin', priority: 5, mode: 'json',
    searchUrl: 'https://www.bixbiy.com/api/discussions?q={keyword}',
  },
  {
    name: 'melost', priority: 5, mode: 'json', jsonResultPath: 'data',
    searchUrl: 'https://www.melost.cn/v1/search/disk?q={keyword}',
  },

  // === HTML plugins (verified URLs from Go source) ===
  { name: 'panlian', priority: 4, searchUrl: 'https://pinglian.lol/search?keyword={keyword}', mode: 'html' },
  { name: 'panta', priority: 4, searchUrl: 'https://www.91panta.cn/search?keyword={keyword}', mode: 'html' },
  { name: 'panzun', priority: 4, searchUrl: 'https://www.panzun.cc/search?keyword={keyword}', mode: 'html' },
  { name: 'panyq', priority: 4, searchUrl: 'https://panyq.com/search?keyword={keyword}', mode: 'html' },
  { name: 'quarksoo', priority: 4, searchUrl: 'https://quarksoo.cc/search.php?keyword={keyword}', mode: 'html' },
  { name: 'quarktv', priority: 4, searchUrl: 'https://www.quarktv.com/search?keyword={keyword}', mode: 'html' },
  { name: 'qupansou', priority: 4, searchUrl: 'https://v.funletu.com/search?keyword={keyword}', mode: 'html' },
  { name: 'qupanshe', priority: 4, searchUrl: 'https://www.qupanshe.com/search?keyword={keyword}', mode: 'html' },
  { name: 'panwiki', priority: 4, searchUrl: 'https://www.panwiki.com/search?q={keyword}', mode: 'html' },
  { name: 'qiwei', priority: 4, searchUrl: 'https://www.qnmp4.com/search?keyword={keyword}', mode: 'html' },
  { name: 'yuhuage', priority: 4, searchUrl: 'https://www.iyuhuage.fun/search?keyword={keyword}', mode: 'html' },
  { name: 'zxzj', priority: 4, searchUrl: 'https://www.zxzjhd.com/search?keyword={keyword}', mode: 'html' },
  { name: 'gaoqing888', priority: 5, searchUrl: 'https://www.gaoqing888.com/search?keyword={keyword}', mode: 'html' },

  // === HTML plugins with specific path patterns ===
  { name: 'ahhhhfs', priority: 5, searchUrl: 'https://www.ahhhhfs.com/?cat=&s={keyword}', mode: 'html' },
  { name: 'aikanzy', priority: 5, searchUrl: 'https://www.aikanzy.com/search?word={keyword}&molds=article', mode: 'html' },
  { name: 'daishudj', priority: 5, searchUrl: 'https://www.daishuduanju.com/?s={keyword}', mode: 'html' },
  { name: 'susu', priority: 5, searchUrl: 'https://susuifa.com/?type=post&s={keyword}', mode: 'html' },
  { name: 'xuexizhinan', priority: 5, searchUrl: 'https://xuexizhinan.com/?post_type=book&s={keyword}', mode: 'html' },
  { name: 'ypfxw', priority: 5, searchUrl: 'https://ypfxw.com/search.php?q={keyword}', mode: 'html' },
  { name: 'thepiratebay', priority: 5, searchUrl: 'https://thpibay.xyz/search/{keyword}/1/99/0', mode: 'html' },
  { name: 'yunsou', priority: 4, searchUrl: 'https://yunsou.xyz/s/{keyword}.html', mode: 'html' },
  { name: 'ash', priority: 5, searchUrl: 'https://so.allsharehub.com/s/{keyword}.html', mode: 'html' },
  { name: 'pianku', priority: 5, searchUrl: 'https://btnull.pro/search?keyword={keyword}', mode: 'html' },
  { name: 'fox4k', priority: 5, searchUrl: 'https://4kfox.com/search?keyword={keyword}', mode: 'html' },

  // === CMS-based search (vod/search/wd pattern) ===
  { name: 'duoduo', priority: 5, searchUrl: 'https://tv.yydsys.top/index.php/vod/search/wd/{keyword}.html', mode: 'html' },
  { name: 'erxiao', priority: 5, searchUrl: 'https://erxiaofn.click/index.php/vod/search/wd/{keyword}.html', mode: 'html' },
  { name: 'labi', priority: 5, searchUrl: 'http://xiaocge.fun/index.php/vod/search/wd/{keyword}.html', mode: 'html' },
  { name: 'muou', priority: 5, searchUrl: 'https://666.666291.xyz/index.php/vod/search/wd/{keyword}.html', mode: 'html' },
  { name: 'zhizhen', priority: 4, searchUrl: 'https://xiaomi666.fun/index.php/vod/search/wd/{keyword}.html', mode: 'html' },
  { name: 'shandian', priority: 4, searchUrl: 'http://1.95.79.193/index.php/vod/search/wd/{keyword}.html', mode: 'html' },
  { name: 'huban', priority: 5, searchUrl: 'http://103.45.162.207:20720/index.php/vod/search/wd/{keyword}.html', mode: 'html' },

  // === Other verified HTML sources ===
  { name: 'xiaoji', priority: 4, searchUrl: 'https://www.xiaojitv.com/search?keyword={keyword}', mode: 'html' },
  { name: 'xiaozhang', priority: 4, searchUrl: 'https://xzys.fun/search?keyword={keyword}', mode: 'html' },
  { name: 'xdpan', priority: 4, searchUrl: 'https://xiongdipan.com/search?keyword={keyword}', mode: 'html' },
  { name: 'yiove', priority: 4, searchUrl: 'https://bbs.yiove.com/search?q={keyword}', mode: 'html' },
  { name: 'u3c3', priority: 4, searchUrl: 'https://u3c3.com/search?keyword={keyword}', mode: 'html' },
  { name: 'xb6v', priority: 4, searchUrl: 'https://www.xb6v.com/search?keyword={keyword}', mode: 'html' },
  { name: 'kkmao', priority: 5, searchUrl: 'https://www.kuakemao.com/?s={keyword}', mode: 'html' },
  { name: 'clxiong', priority: 5, searchUrl: 'https://www.cilixiong.org/e/search/index.php?keyword={keyword}', mode: 'html' },
  { name: 'hdr4k', priority: 5, searchUrl: 'https://www.4khdr.cn/search.php?mod=forum&keyword={keyword}', mode: 'html' },

  // === Sources that may not have direct search URLs ===
  { name: 'gying', priority: 5, searchUrl: 'https://www.gying.net/search?q={keyword}', mode: 'html' },
  { name: 'qqpd', priority: 5, searchUrl: 'https://pd.qq.com/search?q={keyword}', mode: 'html' },
  { name: 'weibo', priority: 5, searchUrl: 'https://s.weibo.com/weibo?q={keyword}', mode: 'html' },
  { name: 'javdb', priority: 5, searchUrl: 'https://javdb.com/search?q={keyword}', mode: 'html' },
  { name: 'nyaa', priority: 5, searchUrl: 'https://nyaa.si/?q={keyword}', mode: 'html' },
  { name: 'ddys', priority: 5, searchUrl: 'https://ddys.pro/search?keyword={keyword}', mode: 'html' },
  { name: 'dyyj', priority: 5, searchUrl: 'https://bbs.dyyjmax.org/search?keyword={keyword}', mode: 'html' },
  { name: 'dyyjpro', priority: 5, searchUrl: 'https://dyyjpro.com/search?keyword={keyword}', mode: 'html' },
  { name: 'hdmoli', priority: 5, searchUrl: 'https://www.hdmoli.pro/search?keyword={keyword}', mode: 'html' },
  { name: 'libvio', priority: 5, searchUrl: 'https://www.libvio.mov/search?keyword={keyword}', mode: 'html' },
  { name: 'wuji', priority: 5, searchUrl: 'https://xcili.net/search?keyword={keyword}', mode: 'html' },
  { name: 'qingying', priority: 5, searchUrl: 'http://revohd.com/search?keyword={keyword}', mode: 'html' },
  { name: 'cldi', priority: 5, searchUrl: 'https://wvmzbxki.1122132.xyz/search-{keyword}-0-2-0.html', mode: 'html' },
  { name: 'clmao', priority: 5, searchUrl: 'https://www.8800492.xyz/search?keyword={keyword}', mode: 'html' },
  { name: 'djgou', priority: 5, searchUrl: 'https://duanjugou.top/search?keyword={keyword}', mode: 'html' },
  { name: 'duanjuw', priority: 5, searchUrl: 'https://sm3.cc/search?keyword={keyword}', mode: 'html' },
  { name: 'jutoushe', priority: 5, searchUrl: 'https://1.star2.cn/search?keyword={keyword}', mode: 'html' },
  { name: 'lingjisp', priority: 5, searchUrl: 'https://web5.mukaku.com/prod/api/v1/search?keyword={keyword}', mode: 'html' },
  { name: 'lou1', priority: 5, searchUrl: 'https://www.1lou.me/search?keyword={keyword}', mode: 'html' },
  { name: 'mizixing', priority: 5, searchUrl: 'https://mizixing.com/search?keyword={keyword}', mode: 'html' },
  { name: 'xinjuc', priority: 5, searchUrl: 'https://www.xinjuc.com/search?keyword={keyword}', mode: 'html' },
  { name: 'yulinshufa', priority: 5, searchUrl: 'http://www.yulinshufa.cn/search?keyword={keyword}', mode: 'html' },
  { name: 'kkv', priority: 5, searchUrl: 'http://kkv.q-23.cn/search?keyword={keyword}', mode: 'html' },
  { name: 'leijing', priority: 5, searchUrl: 'https://leijing.xyz/search?keyword={keyword}', mode: 'html' },
  { name: 'meitizy', priority: 5, searchUrl: 'https://video.451024.xyz/search?keyword={keyword}', mode: 'html' },
  { name: 'nsgame', priority: 5, searchUrl: 'https://nsthwj.com/thwj/game/query?keyword={keyword}', mode: 'html' },
  { name: 'quark4k', priority: 5, searchUrl: 'https://quark4k.com/api/discussions?q={keyword}', mode: 'json' },
  { name: 'discourse', priority: 5, searchUrl: 'https://linux.do/search.json?q={keyword}', mode: 'json' },
  { name: 'jikepan', priority: 5, searchUrl: 'https://api.jikepan.xyz/search?keyword={keyword}', mode: 'json' },
  { name: 'hunhepan', priority: 5, searchUrl: 'https://hunhepan.com/open/search/disk?keyword={keyword}', mode: 'json' },
  { name: 'xdyh', priority: 4, searchUrl: 'https://ys.66ds.de/search?keyword={keyword}', mode: 'html' },
  { name: 'xys', priority: 5, searchUrl: 'https://www.yunso.net/search?keyword={keyword}', mode: 'html' },
];
