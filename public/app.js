const DATA_URL = './data/worldcup.json';
let state = { data: null, active: null };

const $ = (selector) => document.querySelector(selector);
const escapeHtml = (str = '') => String(str).replace(/[&<>'"]/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', "'": '&#39;', '"': '&quot;' }[c]));
const normalizeKey = (text = '') => String(text).toLowerCase().replace(/[\s\-—_·:：|｜,，。.!！?？#【】\[\]()（）《》"“”'‘’]/g, '');

async function loadData() {
  const url = `${DATA_URL}?t=${Date.now()}`;
  const res = await fetch(url, { cache: 'no-store' });
  if (!res.ok) throw new Error(`数据加载失败：HTTP ${res.status}`);
  return res.json();
}

function setHeader(data) {
  $('#siteTitle').textContent = data.title || '世界杯话题雷达';
  $('#siteDesc').textContent = data.description || '自动聚合国内平台世界杯相关话题。';
  $('#updatedAt').textContent = data.generatedAtCN || data.generatedAt || '--';
  const s = data.sourceSummary || {};
  $('#sourceSummary').textContent = `${s.okSources || 0}/${s.totalSources || 0} 个来源可用 · ${s.finalItems || 0} 条话题 · ${s.matchedItems || 0} 条候选命中`;
  $('#fallbackNotice').classList.toggle('hidden', !data.isFallback);
}

function renderSummary(data) {
  const html = (data.platforms || []).map((p) => {
    const top = (p.items || [])[0];
    return `
      <button class="summary-card" data-platform="${p.id}" style="border-color:${p.color || '#dfe7f2'}55">
        <b>${p.emoji || ''} ${escapeHtml(p.name)}</b>
        <strong>${p.count || 0}</strong>
        <small>${top ? `最高：${escapeHtml(top.title)}` : '暂无世界杯相关内容'}</small>
      </button>
    `;
  }).join('');
  $('#platformSummary').innerHTML = html;
  document.querySelectorAll('.summary-card').forEach((el) => {
    el.addEventListener('click', () => setActive(el.dataset.platform));
  });
}

function renderTabs(data) {
  const html = (data.platforms || []).map((p) => `
    <button class="tab ${p.id === state.active ? 'active' : ''}" data-platform="${p.id}">
      ${p.emoji || ''} ${escapeHtml(p.name)} <span>${p.count || 0}</span>
    </button>
  `).join('');
  $('#tabs').innerHTML = html;
  document.querySelectorAll('.tab').forEach((el) => el.addEventListener('click', () => setActive(el.dataset.platform)));
}

function uniqueSources(sources = []) {
  const map = new Map();
  for (const source of sources) {
    const key = `${source.name || ''}:${normalizeKey(source.url || source.rank || '')}`;
    if (!map.has(key)) map.set(key, source);
  }
  return [...map.values()];
}

function renderItems(data) {
  const platform = (data.platforms || []).find((p) => p.id === state.active) || (data.platforms || [])[0];
  if (!platform) {
    $('#list').innerHTML = '<div class="empty">暂无数据</div>';
    return;
  }
  if (!platform.items || platform.items.length === 0) {
    $('#list').innerHTML = `<div class="empty">${escapeHtml(platform.name)} 暂无命中的世界杯相关话题。可等待下次自动更新，或在 config/worldcup.config.json 里增加该平台来源。</div>`;
    return;
  }
  $('#list').innerHTML = platform.items.map((item, idx) => topicCard(item, idx)).join('');
}

function topicCard(item, idx) {
  const tags = (item.tags || []).slice(0, 10).map((tag) => `<span class="pill tag">${escapeHtml(tag)}</span>`).join('');
  const sources = uniqueSources(item.sources || []).slice(0, 5).map((source) => {
    const label = `${source.name || item.sourceName || '来源'}${source.rank ? ` · #${source.rank}` : ''}`;
    const title = source.url ? `<a href="${escapeHtml(source.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>` : escapeHtml(item.title);
    return `<div class="source-link"><span>${title}</span><span>${escapeHtml(label)}</span></div>`;
  }).join('');
  const sourceNames = uniqueSources(item.sources || []).map((s) => s.name).filter(Boolean);
  const meta = [
    `<span class="pill">${sourceNames.length || item.sourceCount || 1} 个来源</span>`,
    item.rank ? `<span class="pill">最高排名 #${item.rank}</span>` : '',
    item.hot ? `<span class="pill">热度 ${item.hot}</span>` : ''
  ].filter(Boolean).join('');
  return `
    <article class="topic-card">
      <div class="rank">${idx + 1}</div>
      <div class="topic-main">
        <h2>${item.url ? `<a href="${escapeHtml(item.url)}" target="_blank" rel="noopener">${escapeHtml(item.title)}</a>` : escapeHtml(item.title)} <span class="score">${Math.round(item.score || 0)} · 热度</span></h2>
        <p class="summary">${escapeHtml(item.summary || '命中世界杯相关关键词，适合作为选题观察入口。')}</p>
        <div class="meta-row">${meta}</div>
        <div class="tag-row">${tags}</div>
        <div class="source-row">${sources}</div>
      </div>
    </article>
  `;
}

function renderDiagnostics(data) {
  const rows = [];
  for (const p of data.platforms || []) {
    for (const s of p.sources || []) {
      rows.push(`<div class="diag ${s.ok ? 'ok' : 'fail'}"><b>${escapeHtml(p.name)} / ${escapeHtml(s.sourceName)}</b><br>${s.ok ? `可用：抓取 ${s.total} 条，命中 ${s.matched} 条` : `失败：${escapeHtml(s.error || '未知错误')}`}</div>`);
    }
  }
  if (data.diagnostics && data.diagnostics.length && !rows.length) {
    for (const d of data.diagnostics) rows.push(`<div class="diag fail"><b>${escapeHtml(d.platformId)} / ${escapeHtml(d.sourceName)}</b><br>${escapeHtml(d.error || '')}</div>`);
  }
  $('#diagnosticsBody').innerHTML = `<div class="diag-grid">${rows.join('') || '<div class="diag">暂无诊断信息。</div>'}</div>`;
}

function setActive(platformId) {
  state.active = platformId;
  renderTabs(state.data);
  renderItems(state.data);
  window.history.replaceState(null, '', `#${platformId}`);
}

async function init() {
  try {
    const data = await loadData();
    state.data = data;
    const hash = location.hash.replace('#', '');
    state.active = (data.platforms || []).some((p) => p.id === hash) ? hash : (data.platforms || [])[0]?.id;
    setHeader(data);
    renderSummary(data);
    renderTabs(data);
    renderItems(data);
    renderDiagnostics(data);
  } catch (error) {
    $('#list').innerHTML = `<div class="empty">${escapeHtml(error.message)}。请确认 public/data/worldcup.json 已生成。</div>`;
  }
}

init();
