import fs from 'node:fs/promises';
import path from 'node:path';
import crypto from 'node:crypto';
import * as cheerio from 'cheerio';
import { XMLParser } from 'fast-xml-parser';


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
  }).formatToParts(date).reduce((acc, part) => {
    acc[part.type] = part.value;
    return acc;
  }, {});
  return `${parts.year}/${parts.month}/${parts.day} ${parts.hour}:${parts.minute}:${parts.second}`;
}

const ROOT = process.cwd();
const CONFIG_PATH = path.join(ROOT, 'config', 'worldcup.config.json');
const OUT_DIR = path.join(ROOT, 'public', 'data');
const OUT_PATH = path.join(OUT_DIR, 'worldcup.json');
const FALLBACK_PATH = path.join(ROOT, 'config', 'fallback-sample.json');

const USER_AGENT = 'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36 WorldCupTopicRadar/1.0';
const MAX_CONCURRENCY = Number(process.env.MAX_CONCURRENCY || 6);
const FETCH_TIMEOUT = Number(process.env.FETCH_TIMEOUT || 8000);

const config = JSON.parse(await fs.readFile(CONFIG_PATH, 'utf-8'));
const RSSHUB_BASE = (process.env[config.rsshubBaseEnv] || config.defaultRsshubBase || 'https://rsshub.app').replace(/\/$/, '');

const xmlParser = new XMLParser({
  ignoreAttributes: false,
  attributeNamePrefix: '',
  textNodeName: 'text',
  cdataPropName: 'cdata',
  parseTagValue: false,
  trimValues: true
});

const sleep = (ms) => new Promise((resolve) => setTimeout(resolve, ms));
const flatten = (arr) => arr.reduce((acc, cur) => acc.concat(cur), []);
const uniq = (arr) => [...new Set(arr.filter(Boolean))];
const toArray = (value) => value === undefined || value === null ? [] : Array.isArray(value) ? value : [value];
const stripHtml = (html = '') => String(html).replace(/<style[\s\S]*?<\/style>/gi, ' ').replace(/<script[\s\S]*?<\/script>/gi, ' ').replace(/<[^>]+>/g, ' ').replace(/&nbsp;/g, ' ').replace(/&amp;/g, '&').replace(/&#39;/g, "'").replace(/&quot;/g, '"').replace(/\s+/g, ' ').trim();
const cleanTitle = (text = '') => stripHtml(text)
  .replace(/#([^#]{1,80})#/g, '$1')
  .replace(/[\u200b\u200c\u200d\ufeff]/g, '')
  .replace(/\s+/g, ' ')
  .trim();
const normalizeKey = (text = '') => cleanTitle(text).toLowerCase().replace(/[\s\-—_·:：|｜,，。.!！?？#【】\[\]()（）《》"“”'‘’]/g, '');
const hash = (text) => crypto.createHash('sha1').update(String(text)).digest('hex').slice(0, 12);

function includesAny(text, words) {
  const low = String(text || '').toLowerCase();
  return words.some((word) => low.includes(String(word).toLowerCase()));
}

function matchWords(text, words) {
  const low = String(text || '').toLowerCase();
  return words.filter((word) => low.includes(String(word).toLowerCase()));
}

function isWorldCupRelated(item) {
  const text = `${item.title || ''} ${item.summary || ''} ${item.description || ''}`;
  if (!text.trim()) return false;
  if (includesAny(text, config.keywords.excludeAny || [])) return false;

  const direct = matchWords(text, config.keywords.mustIncludeAny || []);
  const strong = matchWords(text, config.keywords.strongSignals || []);

  // “世界杯”本身最可靠；“预选赛/国足”必须和足球语境共现，避免其他项目误入。
  if (direct.some((w) => ['世界杯', '2026世界杯', '2026 世界杯', '美加墨世界杯', 'FIFA', '国际足联'].includes(w))) return true;
  if (strong.length > 0) return true;
  if ((text.includes('预选赛') || text.includes('世预赛')) && (text.includes('国足') || text.includes('中国男足') || text.includes('足球') || text.includes('亚洲'))) return true;
  return false;
}

function extractTags(text) {
  const tags = [];
  const allTerms = uniq([...(config.keywords.mustIncludeAny || []), ...(config.keywords.contextTerms || [])]);
  for (const term of allTerms) {
    if (text.toLowerCase().includes(term.toLowerCase())) tags.push(term);
  }
  const hashTags = [...String(text).matchAll(/#([^#\s]{2,40})#/g)].map((m) => m[1]);
  return uniq([...tags, ...hashTags]).slice(0, 12);
}

async function fetchText(url, options = {}) {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), options.timeout || FETCH_TIMEOUT);
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
    if (!res.ok) throw new Error(`HTTP ${res.status}`);
    return await res.text();
  } finally {
    clearTimeout(timeout);
  }
}

async function fetchJson(url, options = {}) {
  const text = await fetchText(url, { ...options, accept: 'application/json,text/plain,*/*' });
  try {
    return JSON.parse(text);
  } catch (e) {
    throw new Error(`JSON parse failed: ${e.message}`);
  }
}

function makeItem(raw, source, platform, index = 0) {
  const title = cleanTitle(raw.title || raw.query || raw.desc || raw.name || raw.word || '');
  const summary = cleanTitle(raw.summary || raw.description || raw.desc || raw.content || '');
  if (!title || title.length < 2) return null;
  const link = raw.url || raw.link || raw.scheme || raw.arcurl || raw.jump_url || raw.pc_url || '';
  const hot = Number(raw.hot || raw.hotScore || raw.heat || raw.score || raw.play || raw.view || 0) || 0;
  const combined = `${title} ${summary}`;
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
    tags: extractTags(combined),
    capturedAt: new Date().toISOString()
  };
}

async function fetchWeiboHot(source, platform) {
  const json = await fetchJson(source.url, { referer: 'https://m.weibo.cn/' });
  const groups = [];
  const cards = toArray(json?.data?.cards);
  for (const card of cards) groups.push(...toArray(card?.card_group));
  return groups.map((row, i) => makeItem({
    title: row.desc || row.word || row.title_sub,
    summary: row.desc_extr || row.note || '',
    url: row.scheme || (row.desc ? `https://s.weibo.com/weibo?q=${encodeURIComponent(row.desc)}` : ''),
    hot: row.desc_extr ? parseInt(String(row.desc_extr).replace(/\D/g, ''), 10) : 0,
    rank: i + 1
  }, source, platform, i)).filter(Boolean);
}

async function fetchBaiduTop(source, platform) {
  const json = await fetchJson(source.url, { referer: 'https://top.baidu.com/' });
  const content = [];
  for (const card of toArray(json?.data?.cards)) content.push(...toArray(card?.content));
  if (content.length === 0 && Array.isArray(json?.data?.list)) content.push(...json.data.list);
  return content.map((row, i) => makeItem({
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
  const json = await fetchJson(url, { referer: `https://search.bilibili.com/all?keyword=${encodeURIComponent(keyword)}` });
  const result = toArray(json?.data?.result);
  return result.map((row, i) => makeItem({
    title: row.title,
    summary: row.description || row.tag || row.author,
    url: row.arcurl || (row.bvid ? `https://www.bilibili.com/video/${row.bvid}` : ''),
    hot: row.play || row.video_review || 0,
    rank: i + 1
  }, source, platform, i)).filter(Boolean);
}

async function fetchZhihuHot(source, platform) {
  const json = await fetchJson(source.url, { referer: 'https://www.zhihu.com/hot' });
  const data = toArray(json?.data);
  return data.map((row, i) => {
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

async function fetchRsshub(source, platform) {
  const url = `${RSSHUB_BASE}${source.path}`;
  const xml = await fetchText(url, { referer: RSSHUB_BASE + '/' });
  const parsed = xmlParser.parse(xml);
  const channel = parsed?.rss?.channel || parsed?.feed || {};
  const rssItems = toArray(channel.item || channel.entry);
  return rssItems.map((row, i) => makeItem({
    title: row.title?.cdata || row.title?.text || row.title,
    summary: row.description?.cdata || row.description?.text || row.description || row.summary?.text || row.summary,
    url: row.link?.href || row.link || row.guid?.text || row.guid,
    hot: row.comments || 0,
    rank: i + 1
  }, source, platform, i)).filter(Boolean);
}

async function fetchHtmlList(source, platform) {
  const html = await fetchText(source.url, { referer: source.url });
  const $ = cheerio.load(html);
  const seen = new Set();
  const items = [];
  for (const selector of source.selectors || ['a']) {
    $(selector).each((i, el) => {
      const $el = $(el);
      const title = cleanTitle($el.attr('title') || $el.text());
      if (!title || title.length < 4) return;
      const key = normalizeKey(title);
      if (seen.has(key)) return;
      seen.add(key);
      let href = $el.attr('href') || '';
      if (href && !href.startsWith('http')) {
        try { href = new URL(href, source.url).toString(); } catch {}
      }
      items.push(makeItem({ title, url: href, rank: items.length + 1 }, source, platform, items.length));
    });
  }
  return items.filter(Boolean).slice(0, 120);
}

async function fetchSource(source, platform) {
  try {
    let items = [];
    if (source.type === 'weiboHot') items = await fetchWeiboHot(source, platform);
    else if (source.type === 'baiduTop') items = await fetchBaiduTop(source, platform);
    else if (source.type === 'bilibiliSearch') items = await fetchBilibiliSearch(source, platform);
    else if (source.type === 'zhihuHot') items = await fetchZhihuHot(source, platform);
    else if (source.type === 'rsshub') items = await fetchRsshub(source, platform);
    else if (source.type === 'htmlList') items = await fetchHtmlList(source, platform);
    else throw new Error(`Unknown source type: ${source.type}`);

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
    if (executing.size >= limit) await Promise.race(executing);
    await sleep(80);
  }
  return Promise.all(ret);
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
        sources: [{ id: item.sourceId, name: item.sourceName, rank: item.rank, url: item.url }],
        sourceCount: 1,
        sampleTitles: [item.title],
        score: scoreItem(item)
      });
    } else {
      current.sources.push({ id: item.sourceId, name: item.sourceName, rank: item.rank, url: item.url });
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
    .map((item) => ({ ...item, score: Math.round(item.score) }))
    .sort((a, b) => b.score - a.score)
    .slice(0, config.maxItemsPerPlatform || 80);
}

function scoreItem(item) {
  const rankScore = item.rank ? Math.max(0, 80 - Number(item.rank)) : 25;
  const hotScore = item.hot ? Math.min(80, Math.log10(Number(item.hot) + 1) * 14) : 0;
  const tagScore = Math.min(30, (item.tags || []).length * 4);
  const strong = matchWords(`${item.title} ${item.summary}`, config.keywords.strongSignals || []).length * 8;
  return (item.weight || 50) + rankScore + hotScore + tagScore + strong;
}

async function run() {
  await fs.mkdir(OUT_DIR, { recursive: true });
  const startedAt = new Date().toISOString();
  const tasks = [];
  for (const platform of config.platforms) {
    for (const source of platform.sources) tasks.push({ platform, source });
  }
  const results = await mapLimit(tasks, MAX_CONCURRENCY, ({ platform, source }) => fetchSource(source, platform));

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
    diagnostics: results.filter((r) => !r.ok).map((r) => ({ platformId: r.platformId, sourceId: r.sourceId, sourceName: r.sourceName, error: r.error })),
    isFallback: false,
    startedAt
  };

  if (totalItems === 0) {
    try {
      const fallback = JSON.parse(await fs.readFile(FALLBACK_PATH, 'utf-8'));
      fallback.generatedAt = new Date().toISOString();
      fallback.generatedAtCN = formatCNDate();
      fallback.sourceSummary = { ...payload.sourceSummary, finalItems: fallback.platforms?.reduce((sum, p) => sum + (p.count || 0), 0) || 0 };
      fallback.rsshubBase = RSSHUB_BASE;
      fallback.diagnostics = payload.diagnostics;
      await fs.writeFile(OUT_PATH, JSON.stringify(fallback, null, 2), 'utf-8');
      console.log('No live matched items. Fallback sample written:', OUT_PATH);
      return;
    } catch (e) {
      console.warn('No fallback sample available:', e.message);
    }
  }

  await fs.writeFile(OUT_PATH, JSON.stringify(payload, null, 2), 'utf-8');
  console.log(`World Cup topic data updated: ${OUT_PATH}`);
  console.log(`Sources ok: ${payload.sourceSummary.okSources}/${payload.sourceSummary.totalSources}; final items: ${payload.sourceSummary.finalItems}`);
}

run().then(() => {
  process.exit(0);
}).catch((error) => {
  console.error(error);
  process.exit(1);
});
