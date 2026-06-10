import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'config', 'worldcup.config.json');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const OUT_PATH = path.join(OUT_DIR, 'worldcup.json');
const FALLBACK_PATH = path.join(ROOT, 'config', 'fallback-sample.json');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36 WorldCupTopicRadar/2.1';

const FETCH_TIMEOUT = Number(process.env.FETCH_TIMEOUT || 10000);
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 5);

let config = {};
try {
  config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
} catch {
  config = {};
}

const RSSHUB_BASE = (process.env.RSSHUB_BASE || config.defaultRsshubBase || 'https://rsshub.app').replace(/\/$/, '');

const DEFAULT_PLATFORMS = [
  { id: 'weibo', name: '微博', emoji: '🔥', color: '#f04438' },
  { id: 'baidu', name: '百度', emoji: '🔎', color: '#2563eb' },
  { id: 'bilibili', name: 'B站', emoji: '📺', color: '#00a1d6' },
  { id: 'zhihu', name: '知乎', emoji: '💬', color: '#1677ff' },
  { id: 'douyin', name: '抖音', emoji: '🎵', color: '#111827' },
  { id: 'hupu', name: '虎扑', emoji: '🏀', color: '#c81e1e' },
  { id: 'dongqiudi', name: '懂球帝', emoji: '⚽', color: '#16a34a' },
  { id: 'xiaohongshu', name: '小红书', emoji: '📕', color: '#ff2442' },
  { id: 'migu', name: '咪咕', emoji: '📡', color: '#7c3aed' },
  { id: 'netease', name: '网易', emoji: '📰', color: '#c20c0c' }
];

const PLATFORMS = DEFAULT_PLATFORMS.map((p) => {
  const old = (config.platforms || []).find((x) => x.id === p.id);
  return { ...p, ...(old || {}) };
});

const WORLD_CUP_TERMS = [
  '世界杯',
  '2026世界杯',
  '2026 世界杯',
  '美加墨世界杯',
  '美加墨',
  '世界杯大数据',
  '世界杯赛程',
  '世界杯门票',
  '世界杯球票',
  '世界杯揭幕战',
  '世界杯小组赛',
  '世界杯分组',
  '世界杯抽签',
  '世界杯预选赛',
  '世预赛',
  '亚洲区预选赛',
  '亚洲预选赛',
  '18强赛',
  '36强赛',
  '国足',
  '中国男足',
  '中国队',
  'FIFA',
  '国际足联',
  '大力神杯',
  '梅西世界杯',
  'C罗世界杯',
  '姆巴佩世界杯',
  '世界杯转播',
  '世界杯直播',
  '咪咕世界杯',
  '央视世界杯',
  '抖音世界杯'
];

const FOOTBALL_CONTEXT_TERMS = [
  '足球',
  '男足',
  '国足',
  '中国男足',
  '国家队',
  '阿根廷',
  '巴西',
  '法国',
  '英格兰',
  '葡萄牙',
  '德国',
  '西班牙',
  '荷兰',
  '意大利',
  '克罗地亚',
  '日本',
  '韩国',
  '伊朗',
  '沙特',
  '卡塔尔',
  '美国',
  '墨西哥',
  '加拿大',
  '梅西',
  'C罗',
  '姆巴佩',
  '哈兰德',
  '贝林厄姆',
  '亚马尔'
];

const ACTION_TERMS = [
  '晋级',
  '出线',
  '淘汰',
  '夺冠',
  '抽签',
  '分组',
  '赛程',
  '揭幕战',
  '小组赛',
  '决赛',
  '半决赛',
  '预选赛',
  '门票',
  '球票',
  '开票',
  '官宣',
  '发布',
  '直播',
  '转播',
  '名单',
  '集训',
  '伤缺',
  '复出',
  '入境',
  '签证',
  '球场',
  '举办城市',
  '吉祥物',
  '主题曲'
];

const EXCLUDE_TERMS = [
  '篮球世界杯',
  '男篮世界杯',
  '女篮世界杯',
  '排球世界杯',
  '电竞世界杯',
  '王者荣耀世界杯',
  '乒乓球世界杯',
  '跳水世界杯',
  '短道世界杯',
  '花滑世界杯',
  '世界杯游戏',
  '游戏世界杯',
  '世界杯冠军皮肤',
  '世界杯模拟器',
  '世界杯广告招商',
  '世界杯素材模板'
];

function formatCNDate(date = new Date()) {
  const parts = new Intl.DateTimeFormat('zh-CN', {
    timeZone: 'Asia/Shanghai',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
    hour: '2-digit',
    minute: '2-digit',
    second: '2-digit',
    hour12: false
  }).formatToParts(date).reduce((acc, p) => {
    acc[p.type] = p.value;
    return acc;
  }, {});

  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

function sleep(ms) {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

function hash(text) {
  return crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 12);
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
}

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function flatten(arr) {
  return arr.reduce((a, b) => a.concat(b), []);
}

function decodeHtml(text = '') {
  return String(text)
    .replace(/<!\[CDATA\[(.*?)\]\]>/gs, '$1')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;/g, "'")
    .replace(/&#(\d+);/g, (_, n) => String.fromCharCode(Number(n)))
    .replace(/&#x([0-9a-fA-F]+);/g, (_, n) => String.fromCharCode(parseInt(n, 16)));
}

function stripHtml(html = '') {
  return decodeHtml(html)
    .replace(/<script[\s\S]*?<\/script>/gi, ' ')
    .replace(/<style[\s\S]*?<\/style>/gi, ' ')
    .replace(/<[^>]+>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function cleanTitle(text = '') {
  return stripHtml(text)
    .replace(/#([^#]{1,80})#/g, '$1')
    .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
    .replace(/\s+/g, ' ')
    .trim();
}

function normalizeKey(text = '') {
  return cleanTitle(text)
    .toLowerCase()
    .replace(/[\s\-—_·:：|｜,，。.!！?？#【】\[\]()（）《》"“”'‘’]/g, '')
    .replace(/[\/\\]/g, '');
}

function includesAny(text, words = []) {
  const low = String(text || '').toLowerCase();
  return words.some((word) => low.includes(String(word).toLowerCase()));
}

function matchWords(text, words = []) {
  const low = String(text || '').toLowerCase();
  return words.filter((word) => low.includes(String(word).toLowerCase()));
}

function isWorldCupRelated(rawText) {
  const text = String(rawText || '');
  if (!text.trim()) return false;
  if (includesAny(text, EXCLUDE_TERMS)) return false;

  if (includesAny(text, WORLD_CUP_TERMS)) return true;

  const hasFootball = includesAny(text, FOOTBALL_CONTEXT_TERMS);
  const hasAction = includesAny(text, ACTION_TERMS);
  const hasQualifier =
    text.includes('世预赛') ||
    text.includes('预选赛') ||
    text.includes('出线') ||
    text.includes('晋级');

  return hasFootball && (hasAction || hasQualifier);
}

function extractTags(text) {
  const tags = [];

  for (const term of [...WORLD_CUP_TERMS, ...FOOTBALL_CONTEXT_TERMS, ...ACTION_TERMS]) {
    if (String(text).toLowerCase().includes(String(term).toLowerCase())) {
      tags.push(term);
    }
  }

  const hashTags = [...String(text).matchAll(/#([^#\s]{2,40})#/g)].map((m) => m[1]);
  return uniq([...tags, ...hashTags]).slice(0, 12);
}

function safeOrigin(url) {
  try {
    return new URL(url).origin + '/';
  } catch {
    return 'https://www.baidu.com/';
  }
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timer = setTimeout(() => controller.abort(), options.timeout || FETCH_TIMEOUT);

  try {
    const res = await fetch(url, {
      signal: controller.signal,
      headers: {
        'user-agent': USER_AGENT,
        'accept': options.accept || 'text/html,application/xhtml+xml,application/xml;q=0.9,application/rss+xml;q=0.8,application/json;q=0.7,*/*;q=0.5',
        'accept-language': 'zh-CN,zh;q=0.9,en;q=0.5',
        'referer': options.referer || safeOrigin(url),
        ...(options.headers || {})
      }
    });

    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timer);
  }
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, {
    ...options,
    accept: 'application/json,text/plain,*/*'
  });

  return JSON.parse(text);
}

function makeItem(raw, source, platform, index = 0) {
  const title = cleanTitle(raw.title || raw.query || raw.desc || raw.name || raw.word || '');
  const summary = cleanTitle(raw.summary || raw.description || raw.desc || raw.content || '');

  if (!title || title.length < 2) return null;

  const combined = `${title} ${summary}`;
  if (!isWorldCupRelated(combined)) return null;

  const url = raw.url || raw.link || raw.scheme || raw.arcurl || raw.jump_url || raw.pc_url || '';
  const hot =
    Number(raw.hot || raw.hotScore || raw.heat || raw.score || raw.play || raw.view || raw.comment || 0) || 0;

  return {
    id: hash(`${platform.id}:${source.id}:${normalizeKey(title)}:${url}`),
    platformId: platform.id,
    platformName: platform.name,
    platformEmoji: platform.emoji,
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type,
    title,
    summary: summary && summary !== title ? summary : '',
    url,
    rank: raw.rank || raw.index || index + 1,
    hot,
    weight: Number(source.weight || 50),
    tags: extractTags(combined),
    capturedAt: new Date().toISOString()
  };
}

async function fetchWeiboHot(source, platform) {
  const json = await fetchJson(source.url, { referer: 'https://m.weibo.cn/' });
  const rows = [];

  for (const card of toArray(json?.data?.cards)) {
    rows.push(...toArray(card?.card_group));
  }

  return rows
    .map((row, i) =>
      makeItem(
        {
          title: row.desc || row.word || row.title_sub,
          summary: row.desc_extr || row.note || '',
          url: row.scheme || (row.desc ? `https://s.weibo.com/weibo?q=${encodeURIComponent(row.desc)}` : ''),
          hot: row.desc_extr ? parseInt(String(row.desc_extr).replace(/\D/g, ''), 10) : 0,
          rank: i + 1
        },
        source,
        platform,
        i
      )
    )
    .filter(Boolean);
}

async function fetchBaiduTop(source, platform) {
  const json = await fetchJson(source.url, { referer: 'https://top.baidu.com/' });
  const rows = [];

  for (const card of toArray(json?.data?.cards)) {
    rows.push(...toArray(card?.content));
  }

  if (Array.isArray(json?.data?.list)) rows.push(...json.data.list);

  return rows
    .map((row, i) =>
      makeItem(
        {
          title: row.query || row.word || row.title,
          summary: row.desc || row.description || '',
          url:
            row.url ||
            row.rawUrl ||
            `https://www.baidu.com/s?wd=${encodeURIComponent(row.query || row.word || row.title || '世界杯')}`,
          hot: row.hotScore || row.hot || 0,
          rank: row.index || i + 1
        },
        source,
        platform,
        i
      )
    )
    .filter(Boolean);
}

function collectBaiduHotGroups(obj, out = []) {
  if (!obj || typeof obj !== 'object') return out;

  if (Array.isArray(obj.hotSearchList)) {
    for (const group of obj.hotSearchList) {
      out.push(group);
    }
  }

  for (const value of Object.values(obj)) {
    if (value && typeof value === 'object') {
      collectBaiduHotGroups(value, out);
    }
  }

  return out;
}

async function fetchBaiduWorldcupBigDataApi(source, platform) {
  const json = await fetchJson(source.url, {
    referer: 'https://seop-landing.baidu.com/seop-landing/worldcup_bigdata/hotlist',
    headers: {
      origin: 'https://seop-landing.baidu.com'
    }
  });

  const groups = collectBaiduHotGroups(json);
  const rows = [];

  for (const group of groups) {
    const groupTitle = group?.title || group?.name || '百度世界杯大数据';
    const list = Array.isArray(group?.list)
      ? group.list
      : Array.isArray(group?.data)
        ? group.data
        : Array.isArray(group?.items)
          ? group.items
          : [];

    list.forEach((item, index) => {
      const title =
        item?.content ||
        item?.title ||
        item?.word ||
        item?.query ||
        item?.name ||
        item?.text ||
        '';

      if (!title) return;

      const hotRaw = item?.num || item?.hot || item?.heat || item?.score || 0;
      const hot = parseFloat(String(hotRaw).replace(/[^\d.]/g, '')) || 0;

      rows.push({
        title,
        summary: `${groupTitle} · 百度世界杯大数据`,
        url: item?.url || item?.link || `https://www.baidu.com/s?wd=${encodeURIComponent(title)}`,
        hot,
        rank: index + 1
      });
    });
  }

  if (rows.length === 0) {
    const fallbackRows = flattenUnknownJson(json);

    rows.push(
      ...fallbackRows.map((row, i) => ({
        title: row.title || row.name || row.word || row.query || row.desc || row.keyword || row.content || '',
        summary: `${row.summary || row.description || row.desc || ''} 百度世界杯大数据`,
        url: row.url || row.link || `https://www.baidu.com/s?wd=${encodeURIComponent(row.title || row.name || row.word || row.query || '世界杯')}`,
        hot: row.hot || row.heat || row.score || row.num || 0,
        rank: row.rank || row.index || i + 1
      }))
    );
  }

  const seen = new Set();

  return rows
    .map((row, index) => makeItem(row, source, platform, index))
    .filter(Boolean)
    .filter((item) => {
      const key = normalizeKey(item.title);
      if (!key || seen.has(key)) return false;
      seen.add(key);
      return true;
    })
    .slice(0, 80);
}

async function fetchBilibiliSearch(source, platform) {
  const keywords = source.keywords || ['世界杯', '美加墨世界杯', '国足 世预赛'];
  const all = [];

  for (const keyword of keywords) {
    try {
      const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&order=totalrank&page=1&page_size=30`;
      const json = await fetchJson(url, {
        referer: `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`
      });

      const rows = toArray(json?.data?.result);

      all.push(
        ...rows
          .map((row, i) =>
            makeItem(
              {
                title: row.title,
                summary: row.description || row.tag || row.author,
                url: row.arcurl || (row.bvid ? `https://www.bilibili.com/video/${row.bvid}` : ''),
                hot: row.play || row.video_review || 0,
                rank: i + 1
              },
              source,
              platform,
              i
            )
          )
          .filter(Boolean)
      );
    } catch {}

    await sleep(120);
  }

  return all;
}

async function fetchZhihuHot(source, platform) {
  const json = await fetchJson(source.url, { referer: 'https://www.zhihu.com/hot' });
  const rows = toArray(json?.data);

  return rows
    .map((row, i) => {
      const target = row.target || row;

      return makeItem(
        {
          title: target.title || row.title,
          summary: target.excerpt || row.detail_text || row.description,
          url: target.url || target.link?.url || row.url,
          hot: row.detail_text ? parseInt(String(row.detail_text).replace(/\D/g, ''), 10) : 0,
          rank: i + 1
        },
        source,
        platform,
        i
      );
    })
    .filter(Boolean);
}

function extractCandidatesFromHtml(html, baseUrl) {
  const rows = [];
  const seen = new Set();

  function add(title, url = '', summary = '') {
    title = cleanTitle(title);
    summary = cleanTitle(summary);

    if (!title || title.length < 4 || title.length > 120) return;
    if (!isWorldCupRelated(`${title} ${summary}`)) return;

    const key = normalizeKey(title);
    if (!key || seen.has(key)) return;
    seen.add(key);

    let finalUrl = url || '';
    if (finalUrl && !finalUrl.startsWith('http')) {
      try {
        finalUrl = new URL(finalUrl, baseUrl).toString();
      } catch {}
    }

    rows.push({ title, summary, url: finalUrl, rank: rows.length + 1 });
  }

  for (const match of String(html).matchAll(/<a\b[^>]*?href=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi)) {
    add(match[2], match[1]);
  }

  for (const match of String(html).matchAll(/<h[1-6][^>]*>([\s\S]*?)<\/h[1-6]>/gi)) {
    add(match[1], baseUrl);
  }

  for (const match of String(html).matchAll(/<title[^>]*>([\s\S]*?)<\/title>/gi)) {
    add(match[1], baseUrl);
  }

  const quoted =
    String(html).match(/["'`]([^"'`]{4,120}(世界杯|世预赛|国足|中国男足|美加墨|FIFA|国际足联)[^"'`]{0,80})["'`]/gi) || [];

  for (const q of quoted.slice(0, 300)) {
    add(q.replace(/^["'`]|["'`]$/g, ''), baseUrl);
  }

  const plain = stripHtml(html);
  const sentences = plain
    .split(/[。！？!?；;\n\r]/)
    .map((s) => s.trim())
    .filter(Boolean);

  for (const s of sentences.slice(0, 500)) {
    if (s.length >= 6 && s.length <= 80) {
      add(s, baseUrl);
    }
  }

  return rows.slice(0, 150);
}

async function fetchHtmlPage(source, platform) {
  const html = await fetchText(source.url, {
    referer: source.referer || source.url
  });

  return extractCandidatesFromHtml(html, source.url)
    .map((row, i) => makeItem(row, source, platform, i))
    .filter(Boolean);
}

function getXmlValue(block, tag) {
  const reg = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = String(block).match(reg);
  return match ? cleanTitle(match[1]) : '';
}

async function fetchRss(source, platform) {
  const url = source.url || `${RSSHUB_BASE}${source.path}`;
  const xml = await fetchText(url, {
    referer: source.referer || RSSHUB_BASE + '/',
    accept: 'application/rss+xml,application/xml,text/xml,text/html,*/*'
  });

  const rows = [];
  const blocks = [
    ...String(xml).matchAll(/<item[\s\S]*?<\/item>/gi),
    ...String(xml).matchAll(/<entry[\s\S]*?<\/entry>/gi)
  ].map((m) => m[0]);

  for (const block of blocks) {
    const title = getXmlValue(block, 'title');
    const summary =
      getXmlValue(block, 'description') ||
      getXmlValue(block, 'summary') ||
      getXmlValue(block, 'content');

    let link = getXmlValue(block, 'link');
    const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
    if (hrefMatch) link = hrefMatch[1];

    rows.push({ title, summary, url: link });
  }

  return rows
    .map((row, i) => makeItem(row, source, platform, i))
    .filter(Boolean);
}

async function fetchBaiduSearch(source, platform) {
  const query = source.query || `site:${source.site} 世界杯`;
  const url = `https://www.baidu.com/s?wd=${encodeURIComponent(query)}`;
  const html = await fetchText(url, {
    referer: 'https://www.baidu.com/'
  });

  return extractCandidatesFromHtml(html, url)
    .map((row, i) =>
      makeItem(
        {
          ...row,
          url: row.url || url,
          rank: i + 1
        },
        source,
        platform,
        i
      )
    )
    .filter(Boolean);
}

async function fetchNewsHotTopics(source, platform) {
  const base = source.base || 'https://jinzc.github.io/news-hot-topics/';
  const candidates = [
    'data/hot.json',
    'data/latest.json',
    'data/rank.json',
    'data/topics.json',
    'hot.json',
    'hot-data.json',
    'data.json',
    'api/hot.json',
    'public/data/hot.json'
  ];

  const all = [];

  for (const file of candidates) {
    try {
      const url = new URL(file, base).toString();
      const json = await fetchJson(url, { referer: base });
      all.push(...flattenUnknownJson(json));
    } catch {}
  }

  try {
    const html = await fetchText(base, { referer: base });
    const scriptLinks = [...html.matchAll(/<script[^>]+src=["']([^"']+)["']/gi)]
      .map((m) => new URL(m[1], base).toString());

    for (const jsUrl of scriptLinks.slice(0, 8)) {
      try {
        const js = await fetchText(jsUrl, { referer: base });
        const rows = extractCandidatesFromHtml(js, base);
        all.push(...rows);
      } catch {}
    }
  } catch {}

  return all
    .map((row, i) => {
      const title = row.title || row.name || row.word || row.query || row.desc || '';
      const platformText = `${row.platform || row.platformName || row.source || row.sourceName || ''}`;

      const shouldKeepPlatform =
        !platformText ||
        platformText.includes(platform.name) ||
        platformText.toLowerCase().includes(platform.id.toLowerCase()) ||
        source.allowCrossPlatform;

      if (!shouldKeepPlatform) return null;

      return makeItem(
        {
          title,
          summary: row.summary || row.description || row.desc || '',
          url: row.url || row.link || '',
          hot: row.hot || row.heat || row.score || 0,
          rank: row.rank || row.index || i + 1
        },
        source,
        platform,
        i
      );
    })
    .filter(Boolean);
}

function flattenUnknownJson(json) {
  const out = [];

  function walk(value, context = {}) {
    if (!value) return;

    if (Array.isArray(value)) {
      for (const item of value) walk(item, context);
      return;
    }

    if (typeof value === 'object') {
      const title =
        value.title ||
        value.name ||
        value.word ||
        value.query ||
        value.desc ||
        value.keyword ||
        value.content ||
        value.text;

      if (title) {
        out.push({
          ...context,
          ...value,
          title
        });
      }

      const nextContext = {
        platform: value.platform || value.platformName || context.platform,
        source: value.source || value.sourceName || context.source
      };

      for (const key of Object.keys(value)) {
        if (typeof value[key] === 'object') {
          walk(value[key], nextContext);
        }
      }
    }
  }

  walk(json);
  return out;
}

const PLATFORM_SOURCES = {
  weibo: [
    {
      id: 'weibo-hot-mobile',
      name: '微博热搜',
      type: 'weiboHot',
      url: 'https://m.weibo.cn/api/container/getIndex?containerid=106003type%3D25%26t%3D3%26disable_hot%3D1%26filter_type%3Drealtimehot',
      weight: 90
    },
    {
      id: 'news-hot-topics-weibo',
      name: '资讯热榜微博补充',
      type: 'newsHotTopics',
      base: 'https://jinzc.github.io/news-hot-topics/',
      weight: 75
    }
  ],

  baidu: [
    {
      id: 'baidu-worldcup-bigdata-api',
      name: '百度世界杯大数据',
      type: 'baiduWorldcupBigDataApi',
      url: `https://motion.baidu.com/api/pagedata?actid=&act=&activity_id=&sessionId=${Date.now()}&aid=fifa_bigdata2026&pid=hotlist`,
      weight: 120
    },
    {
      id: 'baidu-realtime',
      name: '百度热搜',
      type: 'baiduTop',
      url: 'https://top.baidu.com/api/board?platform=wise&tab=realtime',
      weight: 80
    },
    {
      id: 'news-hot-topics-baidu',
      name: '资讯热榜百度补充',
      type: 'newsHotTopics',
      base: 'https://jinzc.github.io/news-hot-topics/',
      weight: 75
    }
  ],

  bilibili: [
    {
      id: 'bilibili-worldcup-search',
      name: 'B站世界杯搜索',
      type: 'bilibiliSearch',
      keywords: ['世界杯', '美加墨世界杯', '国足 世预赛', '梅西 世界杯', 'FIFA 世界杯'],
      weight: 85
    },
    {
      id: 'news-hot-topics-bilibili',
      name: '资讯热榜B站补充',
      type: 'newsHotTopics',
      base: 'https://jinzc.github.io/news-hot-topics/',
      weight: 70
    }
  ],

  zhihu: [
    {
      id: 'zhihu-hot',
      name: '知乎热榜',
      type: 'zhihuHot',
      url: 'https://www.zhihu.com/api/v3/feed/topstory/hot-lists/total?limit=100&desktop=true',
      weight: 85
    },
    {
      id: 'news-hot-topics-zhihu',
      name: '资讯热榜知乎补充',
      type: 'newsHotTopics',
      base: 'https://jinzc.github.io/news-hot-topics/',
      weight: 75
    },
    {
      id: 'baidu-search-zhihu',
      name: '百度站内搜索知乎',
      type: 'baiduSearch',
      site: 'zhihu.com',
      query: 'site:zhihu.com 世界杯 OR 世预赛 OR 国足',
      weight: 55
    }
  ],

  douyin: [
    {
      id: 'news-hot-topics-douyin',
      name: '资讯热榜抖音补充',
      type: 'newsHotTopics',
      base: 'https://jinzc.github.io/news-hot-topics/',
      weight: 85
    },
    {
      id: 'baidu-search-douyin',
      name: '百度站内搜索抖音',
      type: 'baiduSearch',
      site: 'douyin.com',
      query: 'site:douyin.com 世界杯 OR 世预赛 OR 国足',
      weight: 55
    }
  ],

  hupu: [
    {
      id: 'hupu-soccer',
      name: '虎扑足球',
      type: 'htmlPage',
      url: 'https://soccer.hupu.com/',
      weight: 100
    },
    {
      id: 'hupu-bbs-soccer',
      name: '虎扑足球话题区',
      type: 'htmlPage',
      url: 'https://bbs.hupu.com/all-soccer',
      weight: 85
    },
    {
      id: 'baidu-search-hupu',
      name: '百度站内搜索虎扑',
      type: 'baiduSearch',
      site: 'hupu.com',
      query: 'site:hupu.com 世界杯 OR 世预赛 OR 国足',
      weight: 55
    }
  ],

  dongqiudi: [
    {
      id: 'dongqiudi-home',
      name: '懂球帝首页',
      type: 'htmlPage',
      url: 'https://www.dongqiudi.com/',
      weight: 90
    },
    {
      id: 'baidu-search-dongqiudi',
      name: '百度站内搜索懂球帝',
      type: 'baiduSearch',
      site: 'dongqiudi.com',
      query: 'site:dongqiudi.com 世界杯 OR 世预赛 OR 国足 OR FIFA',
      weight: 60
    }
  ],

  xiaohongshu: [
    {
      id: 'baidu-search-xiaohongshu',
      name: '百度站内搜索小红书',
      type: 'baiduSearch',
      site: 'xiaohongshu.com',
      query: 'site:xiaohongshu.com 世界杯 OR 美加墨世界杯 OR 国足',
      weight: 70
    }
  ],

  migu: [
    {
      id: 'migu-worldcup-page',
      name: '咪咕世界杯专题页',
      type: 'htmlPage',
      url: 'https://www.miguvideo.com/p/home/7a04ba680afd4b49a31913c5b36e4557',
      weight: 95
    },
    {
      id: 'migu-home',
      name: '咪咕视频首页',
      type: 'htmlPage',
      url: 'https://www.miguvideo.com/',
      weight: 85
    },
    {
      id: 'baidu-search-migu',
      name: '百度站内搜索咪咕',
      type: 'baiduSearch',
      site: 'miguvideo.com',
      query: 'site:miguvideo.com 世界杯 OR 美加墨世界杯 OR 咪咕世界杯',
      weight: 65
    }
  ],

  netease: [
    {
      id: 'netease-sports',
      name: '网易体育',
      type: 'htmlPage',
      url: 'https://sports.163.com/',
      weight: 85
    },
    {
      id: 'netease-worldcup-search',
      name: '百度站内搜索网易',
      type: 'baiduSearch',
      site: '163.com',
      query: 'site:163.com 世界杯 OR 美加墨世界杯 OR 世预赛 OR 国足',
      weight: 70
    }
  ]
};

async function fetchSource(source, platform) {
  try {
    let items = [];

    if (source.type === 'weiboHot') items = await fetchWeiboHot(source, platform);
    else if (source.type === 'baiduTop') items = await fetchBaiduTop(source, platform);
    else if (source.type === 'baiduWorldcupBigDataApi') items = await fetchBaiduWorldcupBigDataApi(source, platform);
    else if (source.type === 'bilibiliSearch') items = await fetchBilibiliSearch(source, platform);
    else if (source.type === 'zhihuHot') items = await fetchZhihuHot(source, platform);
    else if (source.type === 'htmlPage') items = await fetchHtmlPage(source, platform);
    else if (source.type === 'rss') items = await fetchRss(source, platform);
    else if (source.type === 'baiduSearch') items = await fetchBaiduSearch(source, platform);
    else if (source.type === 'newsHotTopics') items = await fetchNewsHotTopics(source, platform);
    else throw new Error(`Unknown source type: ${source.type}`);

    return {
      ok: true,
      sourceId: source.id,
      sourceName: source.name,
      platformId: platform.id,
      total: items.length,
      matched: items.length,
      items
    };
  } catch (error) {
    return {
      ok: false,
      sourceId: source.id,
      sourceName: source.name,
      platformId: platform.id,
      total: 0,
      matched: 0,
      error: error.message,
      items: []
    };
  }
}

async function mapLimit(list, limit, fn) {
  const ret = [];
  const executing = new Set();

  for (const item of list) {
    const p = Promise.resolve().then(() => fn(item));
    ret.push(p);
    executing.add(p);

    const clean = () => executing.delete(p);
    p.then(clean).catch(clean);

    if (executing.size >= limit) await Promise.race(executing);
    await sleep(80);
  }

  return Promise.all(ret);
}

function scoreItem(item) {
  const rankScore = item.rank ? Math.max(0, 80 - Number(item.rank)) : 25;
  const hotScore = item.hot ? Math.min(80, Math.log10(Number(item.hot) + 1) * 14) : 0;
  const tagScore = Math.min(30, (item.tags || []).length * 4);
  const sourceScore = item.weight || 50;

  return sourceScore + rankScore + hotScore + tagScore;
}

function uniqBy(arr, fn) {
  const seen = new Set();
  const out = [];

  for (const item of arr) {
    const key = fn(item);
    if (seen.has(key)) continue;
    seen.add(key);
    out.push(item);
  }

  return out;
}

function mergeItems(items) {
  const map = new Map();

  for (const item of items) {
    const key = normalizeKey(item.title);
    if (!key || key.length < 2) continue;

    const current = map.get(key);

    if (!current) {
      map.set(key, {
        ...item,
        sources: [
          {
            id: item.sourceId,
            name: item.sourceName,
            rank: item.rank,
            url: item.url
          }
        ],
        sourceCount: 1,
        score: scoreItem(item)
      });
    } else {
      current.sources.push({
        id: item.sourceId,
        name: item.sourceName,
        rank: item.rank,
        url: item.url
      });

      current.sourceCount = uniq(current.sources.map((s) => s.id)).length;
      current.hot = Math.max(Number(current.hot || 0), Number(item.hot || 0));
      current.tags = uniq([...current.tags, ...item.tags]).slice(0, 12);
      current.score += scoreItem(item) * 0.45;

      if (!current.summary && item.summary) current.summary = item.summary;
      if (!current.url && item.url) current.url = item.url;
    }
  }

  return [...map.values()]
    .map((item) => ({
      ...item,
      score: Math.round(item.score),
      sources: uniqBy(item.sources, (s) => `${s.id}:${s.rank}:${s.url}`).slice(0, 5)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, config.maxItemsPerPlatform || 80);
}

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const tasks = [];

  for (const platform of PLATFORMS) {
    const sources = PLATFORM_SOURCES[platform.id] || [];
    for (const source of sources) {
      tasks.push({ platform, source });
    }
  }

  const results = await mapLimit(tasks, MAX_CONCURRENCY, ({ platform, source }) => {
    return fetchSource(source, platform);
  });

  const platforms = [];

  for (const platform of PLATFORMS) {
    const relatedResults = results.filter((r) => r.platformId === platform.id);
    const rawItems = flatten(relatedResults.map((r) => r.items));
    const merged = mergeItems(rawItems);

    platforms.push({
      id: platform.id,
      name: platform.name,
      emoji: platform.emoji,
      color: platform.color,
      count: merged.length,
      sourceCount: relatedResults.length,
      availableSourceCount: relatedResults.filter((r) => r.ok).length,
      rawMatchedCount: rawItems.length,
      items: merged,
      sources: relatedResults.map(({ items, ...r }) => r)
    });
  }

  const totalItems = platforms.reduce((sum, p) => sum + p.count, 0);

  const payload = {
    generatedAt: new Date().toISOString(),
    generatedAtCN: formatCNDate(),
    title: config.title || '世界杯话题雷达',
    description:
      config.description ||
      '聚合微博、百度、B站、知乎、抖音、虎扑、懂球帝、小红书、咪咕、网易等平台的世界杯相关话题。',
    rsshubBase: RSSHUB_BASE,
    sourceSummary: {
      totalSources: tasks.length,
      okSources: results.filter((r) => r.ok).length,
      failedSources: results.filter((r) => !r.ok).length,
      candidateItems: results.reduce((sum, r) => sum + r.total, 0),
      matchedItems: results.reduce((sum, r) => sum + r.matched, 0),
      finalItems: totalItems
    },
    platforms,
    diagnostics: results
      .filter((r) => !r.ok)
      .map((r) => ({
        platformId: r.platformId,
        sourceId: r.sourceId,
        sourceName: r.sourceName,
        error: r.error
      })),
    isFallback: false
  };

  if (totalItems === 0) {
    try {
      const fallback = JSON.parse(await fs.readFile(FALLBACK_PATH, 'utf-8'));
      fallback.generatedAt = new Date().toISOString();
      fallback.generatedAtCN = formatCNDate();
      fallback.rsshubBase = RSSHUB_BASE;
      fallback.diagnostics = payload.diagnostics;
      fallback.sourceSummary = {
        ...payload.sourceSummary,
        finalItems: fallback.platforms?.reduce((sum, p) => sum + (p.count || 0), 0) || 0
      };

      await fs.writeFile(OUT_PATH, JSON.stringify(fallback, null, 2), 'utf-8');
      console.log('No live matched items. Fallback sample written:', OUT_PATH);
      return;
    } catch (error) {
      console.warn('No fallback sample available:', error.message);
    }
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(payload, null, 2), 'utf-8');

  console.log(`World Cup topic data updated: ${OUT_PATH}`);
  console.log(`Sources ok: ${payload.sourceSummary.okSources}/${payload.sourceSummary.totalSources}; final items: ${payload.sourceSummary.finalItems}`);

  for (const p of platforms) {
    console.log(`${p.name}: ${p.count} items, ${p.availableSourceCount}/${p.sourceCount} sources ok`);
  }
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
