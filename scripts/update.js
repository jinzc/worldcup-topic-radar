import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'config', 'worldcup.config.json');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const OUT_PATH = path.join(OUT_DIR, 'worldcup.json');
const FALLBACK_PATH = path.join(ROOT, 'config', 'fallback-sample.json');

const USER_AGENT =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 Chrome/126 Safari/537.36 WorldCupTopicRadar/1.0';

const FETCH_TIMEOUT = Number(process.env.FETCH_TIMEOUT || 9000);
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 5);

const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
const RSSHUB_BASE = (process.env[config.rsshubBaseEnv] || config.defaultRsshubBase || 'https://rsshub.app').replace(/\/$/, '');

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

function toArray(value) {
  if (value === undefined || value === null) return [];
  return Array.isArray(value) ? value : [value];
}

function uniq(arr) {
  return [...new Set(arr.filter(Boolean))];
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
    .replace(/[\s\-—_·:：|｜,，。.!！?？#【】\[\]()（）《》"“”'‘’]/g, '');
}

function includesAny(text, words = []) {
  const low = String(text || '').toLowerCase();
  return words.some((word) => low.includes(String(word).toLowerCase()));
}

function matchWords(text, words = []) {
  const low = String(text || '').toLowerCase();
  return words.filter((word) => low.includes(String(word).toLowerCase()));
}

function extractTags(text) {
  const terms = uniq([
    ...(config.keywords.mustIncludeAny || []),
    ...(config.keywords.contextTerms || []),
    ...(config.keywords.strongSignals || [])
  ]);

  const tags = [];

  for (const term of terms) {
    if (String(text).toLowerCase().includes(String(term).toLowerCase())) {
      tags.push(term);
    }
  }

  const hashTags = [...String(text).matchAll(/#([^#\s]{2,40})#/g)].map((m) => m[1]);

  return uniq([...tags, ...hashTags]).slice(0, 12);
}

function isWorldCupRelated(item) {
  const text = `${item.title || ''} ${item.summary || ''} ${item.description || ''}`;
  if (!text.trim()) return false;

  if (includesAny(text, config.keywords.excludeAny || [])) return false;

  const direct = matchWords(text, config.keywords.mustIncludeAny || []);
  const strong = matchWords(text, config.keywords.strongSignals || []);

  if (direct.length > 0) return true;
  if (strong.length > 0) return true;

  if (
    (text.includes('预选赛') || text.includes('世预赛')) &&
    (text.includes('国足') || text.includes('中国男足') || text.includes('亚洲') || text.includes('足球'))
  ) {
    return true;
  }

  return false;
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
        'referer': options.referer || new URL(url).origin + '/',
        ...(options.headers || {})
      }
    });

    if (!res.ok) {
      throw new Error(`HTTP ${res.status}`);
    }

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

  const link = raw.url || raw.link || raw.scheme || raw.arcurl || raw.jump_url || raw.pc_url || '';
  const hot = Number(raw.hot || raw.hotScore || raw.heat || raw.score || raw.play || raw.view || 0) || 0;

  return {
    id: hash(`${platform.id}:${source.id}:${normalizeKey(title)}:${link}`),
    platformId: platform.id,
    platformName: platform.name,
    platformEmoji: platform.emoji,
    sourceId: source.id,
    sourceName: source.name,
    sourceType: source.type,
    title,
    summary: summary && summary !== title ? summary : '',
    url: link,
    rank: raw.rank || raw.index || index + 1,
    hot,
    weight: Number(source.weight || 50),
    tags: extractTags(`${title} ${summary}`),
    capturedAt: new Date().toISOString()
  };
}

async function fetchWeiboHot(source, platform) {
  const json = await fetchJson(source.url, { referer: 'https://m.weibo.cn/' });
  const cards = toArray(json?.data?.cards);
  const rows = [];

  for (const card of cards) {
    rows.push(...toArray(card?.card_group));
  }

  return rows.map((row, i) => makeItem({
    title: row.desc || row.word || row.title_sub,
    summary: row.desc_extr || row.note || '',
    url: row.scheme || (row.desc ? `https://s.weibo.com/weibo?q=${encodeURIComponent(row.desc)}` : ''),
    hot: row.desc_extr ? parseInt(String(row.desc_extr).replace(/\D/g, ''), 10) : 0,
    rank: i + 1
  }, source, platform, i)).filter(Boolean);
}

async function fetchBaiduTop(source, platform) {
  const json = await fetchJson(source.url, { referer: 'https://top.baidu.com/' });
  const rows = [];

  for (const card of toArray(json?.data?.cards)) {
    rows.push(...toArray(card?.content));
  }

  if (rows.length === 0 && Array.isArray(json?.data?.list)) {
    rows.push(...json.data.list);
  }

  return rows.map((row, i) => makeItem({
    title: row.query || row.word || row.title,
    summary: row.desc || row.description || '',
    url: row.url || row.rawUrl || `https://www.baidu.com/s?wd=${encodeURIComponent(row.query || row.word || row.title || '世界杯')}`,
    hot: row.hotScore || row.hot || 0,
    rank: row.index || i + 1
  }, source, platform, i)).filter(Boolean);
}

async function fetchBilibiliSearch(source, platform) {
  const keyword = source.keyword || '世界杯';
  const url = `https://api.bilibili.com/x/web-interface/search/type?search_type=video&keyword=${encodeURIComponent(keyword)}&order=totalrank&page=1&page_size=40`;

  const json = await fetchJson(url, {
    referer: `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}`
  });

  const rows = toArray(json?.data?.result);

  return rows.map((row, i) => makeItem({
    title: row.title,
    summary: row.description || row.tag || row.author,
    url: row.arcurl || (row.bvid ? `https://www.bilibili.com/video/${row.bvid}` : ''),
    hot: row.play || row.video_review || 0,
    rank: i + 1
  }, source, platform, i)).filter(Boolean);
}

async function fetchZhihuHot(source, platform) {
  const json = await fetchJson(source.url, { referer: 'https://www.zhihu.com/hot' });
  const rows = toArray(json?.data);

  return rows.map((row, i) => {
    const target = row.target || row;

    return makeItem({
      title: target.title || row.title,
      summary: target.excerpt || row.detail_text || row.description,
      url: target.url || target.link?.url || row.url,
      hot: row.detail_text ? parseInt(String(row.detail_text).replace(/\D/g, ''), 10) : 0,
      rank: i + 1
    }, source, platform, i);
  }).filter(Boolean);
}

function parseRssItems(xml) {
  const items = [];

  const itemBlocks = [...String(xml).matchAll(/<item[\s\S]*?<\/item>/gi)].map((m) => m[0]);
  const entryBlocks = [...String(xml).matchAll(/<entry[\s\S]*?<\/entry>/gi)].map((m) => m[0]);

  for (const block of [...itemBlocks, ...entryBlocks]) {
    const title = getXmlValue(block, 'title');
    const summary =
      getXmlValue(block, 'description') ||
      getXmlValue(block, 'summary') ||
      getXmlValue(block, 'content');

    let link = getXmlValue(block, 'link');

    const hrefMatch = block.match(/<link[^>]+href=["']([^"']+)["'][^>]*>/i);
    if (hrefMatch) {
      link = hrefMatch[1];
    }

    items.push({
      title,
      summary,
      url: link
    });
  }

  return items;
}

function getXmlValue(block, tag) {
  const reg = new RegExp(`<${tag}[^>]*>([\\s\\S]*?)<\\/${tag}>`, 'i');
  const match = String(block).match(reg);
  return match ? cleanTitle(match[1]) : '';
}

async function fetchRsshub(source, platform) {
  const url = `${RSSHUB_BASE}${source.path}`;
  const xml = await fetchText(url, {
    referer: RSSHUB_BASE + '/',
    accept: 'application/rss+xml,application/xml,text/xml,text/html,*/*'
  });

  const rows = parseRssItems(xml);

  return rows.map((row, i) => makeItem({
    title: row.title,
    summary: row.summary,
    url: row.url,
    rank: i + 1
  }, source, platform, i)).filter(Boolean);
}

async function fetchHtmlList(source, platform) {
  const html = await fetchText(source.url, { referer: source.url });
  const anchors = [...html.matchAll(/<a\b[^>]*?href=["']?([^"'\s>]+)["']?[^>]*>([\s\S]*?)<\/a>/gi)];

  const seen = new Set();
  const items = [];

  for (const match of anchors) {
    const rawHref = match[1] || '';
    const title = cleanTitle(match[2] || '');

    if (!title || title.length < 4) continue;

    const key = normalizeKey(title);
    if (!key || seen.has(key)) continue;
    seen.add(key);

    let href = rawHref;

    if (href && !href.startsWith('http')) {
      try {
        href = new URL(href, source.url).toString();
      } catch {}
    }

    items.push(makeItem({
      title,
      url: href,
      rank: items.length + 1
    }, source, platform, items.length));

    if (items.length >= 120) break;
  }

  return items.filter(Boolean);
}

async function fetchSource(source, platform) {
  try {
    let items = [];

    if (source.type === 'weiboHot') {
      items = await fetchWeiboHot(source, platform);
    } else if (source.type === 'baiduTop') {
      items = await fetchBaiduTop(source, platform);
    } else if (source.type === 'bilibiliSearch') {
      items = await fetchBilibiliSearch(source, platform);
    } else if (source.type === 'zhihuHot') {
      items = await fetchZhihuHot(source, platform);
    } else if (source.type === 'rsshub') {
      items = await fetchRsshub(source, platform);
    } else if (source.type === 'htmlList') {
      items = await fetchHtmlList(source, platform);
    } else {
      throw new Error(`Unknown source type: ${source.type}`);
    }

    const filtered = items.filter(isWorldCupRelated);

    return {
      ok: true,
      sourceId: source.id,
      sourceName: source.name,
      platformId: platform.id,
      total: items.length,
      matched: filtered.length,
      items: filtered
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

    if (executing.size >= limit) {
      await Promise.race(executing);
    }

    await sleep(80);
  }

  return Promise.all(ret);
}

function scoreItem(item) {
  const rankScore = item.rank ? Math.max(0, 80 - Number(item.rank)) : 25;
  const hotScore = item.hot ? Math.min(80, Math.log10(Number(item.hot) + 1) * 14) : 0;
  const tagScore = Math.min(30, (item.tags || []).length * 4);
  const strongScore = matchWords(`${item.title} ${item.summary}`, config.keywords.strongSignals || []).length * 8;

  return (item.weight || 50) + rankScore + hotScore + tagScore + strongScore;
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
        sampleTitles: [item.title],
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
      current.weight = Math.max(Number(current.weight || 0), Number(item.weight || 0));
      current.tags = uniq([...current.tags, ...item.tags]).slice(0, 12);
      current.score += scoreItem(item) * 0.45;

      if (!current.summary && item.summary) current.summary = item.summary;
      if (!current.url && item.url) current.url = item.url;

      current.sampleTitles = uniq([...current.sampleTitles, item.title]).slice(0, config.sampleLimitPerItem || 2);
    }
  }

  return [...map.values()]
    .map((item) => ({
      ...item,
      score: Math.round(item.score)
    }))
    .sort((a, b) => b.score - a.score)
    .slice(0, config.maxItemsPerPlatform || 80);
}

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });

  const startedAt = new Date().toISOString();
  const tasks = [];

  for (const platform of config.platforms) {
    for (const source of platform.sources) {
      tasks.push({ platform, source });
    }
  }

  const results = await mapLimit(tasks, MAX_CONCURRENCY, ({ platform, source }) => {
    return fetchSource(source, platform);
  });

  const platforms = [];

  for (const platform of config.platforms) {
    const relatedResults = results.filter((r) => r.platformId === platform.id);
    const rawItems = flatten(relatedResults.map((r) => r.items));
    const merged = mergeItems(rawItems);

    platforms.push({
      id: platform.id,
      name: platform.name,
      emoji: platform.emoji,
      color: platform.color,
      count: merged.length,
      sourceCount: platform.sources.length,
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
    title: config.title,
    description: config.description,
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
    isFallback: false,
    startedAt
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
}

run()
  .then(() => process.exit(0))
  .catch((error) => {
    console.error(error);
    process.exit(1);
  });
