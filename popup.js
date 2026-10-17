const searchEl = document.getElementById('search');
const resultsEl = document.getElementById('results');
const btnSuspend = document.getElementById('btn-suspend');
const btnGroup = document.getElementById('btn-group');
const btnDupes = document.getElementById('btn-dupes');
const btnSettings = document.getElementById('btn-settings');
const btnShowSave = document.getElementById('btn-show-save');
const btnDoSave = document.getElementById('btn-do-save');
const btnCancelSave = document.getElementById('btn-cancel-save');
const btnTheme = document.getElementById('btn-theme');
const wsForm = document.getElementById('ws-form');
const wsNameInput = document.getElementById('ws-name');
const wsCurrentOnly = document.getElementById('ws-current-only');
const wsListEl = document.getElementById('ws-list');

let allTabs = [];
let filtered = [];
let selectedIndex = 0;

chrome.storage.local.get('theme', ({ theme }) => {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
});
btnTheme.addEventListener('click', () => {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const newTheme = isLight ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  chrome.storage.local.set({ theme: newTheme });
});

async function loadTabs() {
  allTabs = await chrome.tabs.query({});
  render();
}

function score(query, tab) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const title = (tab.title || '').toLowerCase();
  const url = (tab.url || '').toLowerCase();
  if (title.startsWith(q)) return 1000;
  const ti = title.indexOf(q); if (ti !== -1) return 800 - ti;
  const ui = url.indexOf(q); if (ui !== -1) return 600 - ui;
  const words = title.split(/\s+/);
  for (const w of words) if (w.startsWith(q)) return 500;
  let qi = 0;
  for (let i = 0; i < title.length && qi < q.length; i++) { if (title[i] === q[qi]) qi++; }
  return qi === q.length ? 100 : -1;
}

function escapeHtml(s) { return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c])); }
function faviconFor(tab) {
  if (tab.favIconUrl) return tab.favIconUrl;
  try { return `https://www.google.com/s2/favicons?domain=${new URL(tab.url).hostname}&sz=32`; } 
  catch { return 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'; }
}

function render() {
  const q = searchEl.value.trim();
  filtered = allTabs.map((t) => ({ tab: t, s: score(q, t) })).filter((x) => x.s >= 0).sort((a, b) => b.s - a.s).map((x) => x.tab);
  if (selectedIndex >= filtered.length) selectedIndex = filtered.length - 1;
  if (selectedIndex < 0) selectedIndex = 0;
  resultsEl.innerHTML = '';
  if (!filtered.length) { resultsEl.innerHTML = '<div class="empty">Ничего не найдено</div>'; return; }
  filtered.forEach((tab, i) => {
    const el = document.createElement('div');
    el.className = 'item' + (i === selectedIndex ? ' active' : '');
    el.innerHTML = `<img class="fav" src="${faviconFor(tab)}" alt=""><div class="meta"><div class="title">${escapeHtml(tab.title || 'Без названия')}</div><div class="url">${escapeHtml(tab.url || '')}</div></div>`;
    el.addEventListener('click', () => activate(tab));
    resultsEl.appendChild(el);
  });
}

async function activate(tab) {
  await chrome.tabs.update(tab.id, { active: true });
  await chrome.windows.update(tab.windowId, { focused: true });
  window.close();
}

searchEl.addEventListener('input', () => { selectedIndex = 0; render(); });
searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'ArrowDown') { e.preventDefault(); if (selectedIndex < filtered.length - 1) selectedIndex++; render(); scrollActiveIntoView(); }
  else if (e.key === 'ArrowUp') { e.preventDefault(); if (selectedIndex > 0) selectedIndex--; render(); scrollActiveIntoView(); }
  else if (e.key === 'Enter') { e.preventDefault(); if (filtered[selectedIndex]) activate(filtered[selectedIndex]); }
  else if (e.key === 'Escape') { window.close(); }
});
function scrollActiveIntoView() { const el = resultsEl.querySelector('.item.active'); if (el) el.scrollIntoView({ block: 'nearest' }); }

btnSuspend.addEventListener('click', async () => { await chrome.runtime.sendMessage({ type: 'suspendInactiveNow' }); window.close(); });
btnSettings.addEventListener('click', () => chrome.runtime.openOptionsPage());
btnDupes.addEventListener('click', async () => {
  const seenUrls = new Set(); const toRemove = [];
  const sortedTabs = [...allTabs].sort((a, b) => b.id - a.id);
  for (const tab of sortedTabs) {
    if (!tab.url || tab.url === 'chrome://newtab/') continue;
    if (seenUrls.has(tab.url)) toRemove.push(tab.id); else seenUrls.add(tab.url);
  }
  if (toRemove.length > 0) { await chrome.tabs.remove(toRemove); loadTabs(); } else alert('Дубликатов не найдено!');
});

// --- ЛОКАЛЬНАЯ ГРУППИРОВКА ПО ДОМЕНАМ ---
btnGroup.addEventListener('click', async () => {
  const tabs = await chrome.tabs.query({});
  const byDomain = new Map();
  for (const t of tabs) {
    if (t.groupId !== -1) continue;
    try {
      const host = new URL(t.url).hostname.replace('www.', '');
      if (!byDomain.has(host)) byDomain.set(host, []);
      byDomain.get(host).push(t.id);
    } catch {}
  }
  const palette = ['grey', 'blue', 'red', 'yellow', 'green', 'pink', 'purple', 'cyan', 'orange'];
  let i = 0;
  let grouped = 0;
  for (const [host, ids] of byDomain) {
    if (ids.length < 2) continue;
    try {
      const groupId = await chrome.tabs.group({ tabIds: ids });
      await chrome.tabGroups.update(groupId, { title: host, color: palette[i % palette.length] });
      i++;
      grouped++;
    } catch (e) { console.warn(e); }
  }
  if (grouped === 0) alert('Не найдено доменов с 2+ вкладками для группировки.');
  window.close();
});

btnShowSave.addEventListener('click', () => { wsForm.classList.add('active'); wsNameInput.value = ''; wsNameInput.focus(); });
btnCancelSave.addEventListener('click', () => wsForm.classList.remove('active'));
btnDoSave.addEventListener('click', async () => {
  const name = wsNameInput.value.trim();
  if (!name) return alert('Введите имя сессии!');
  const tabsToSave = wsCurrentOnly.checked ? await chrome.tabs.query({ currentWindow: true }) : allTabs;
  const data = await chrome.storage.sync.get('workspaces');
  const workspaces = data.workspaces || {};
  workspaces[name] = tabsToSave.map(t => ({ url: t.url, title: t.title }));
  await chrome.storage.sync.set({ workspaces }); chrome.runtime.sendMessage({ type: 'updateContextMenus' });
  wsForm.classList.remove('active'); loadWorkspaces();
});

async function loadWorkspaces() {
  const data = await chrome.storage.sync.get('workspaces');
  const workspaces = data.workspaces || {};
  wsListEl.innerHTML = '';
  const keys = Object.keys(workspaces);
  if (keys.length === 0) { wsListEl.innerHTML = '<div style="font-size:12px;color:var(--text-muted);padding:4px;">Нет сохранённых сессий</div>'; return; }
  for (const name of keys) {
    const ws = workspaces[name];
    const el = document.createElement('div');
    el.className = 'ws-item';
    el.innerHTML = `<span class="ws-name" title="${ws.length} вкладок">${escapeHtml(name)} (${ws.length})</span><span class="ws-del" title="Удалить">✕</span>`;
    el.querySelector('.ws-name').addEventListener('click', async () => {
      const urls = ws.map(t => t.url).filter(Boolean);
      if (urls.length > 0) { await chrome.windows.create({ url: urls }); window.close(); }
    });
    el.querySelector('.ws-del').addEventListener('click', async (e) => {
      e.stopPropagation(); delete workspaces[name];
      await chrome.storage.sync.set({ workspaces }); chrome.runtime.sendMessage({ type: 'updateContextMenus' }); loadWorkspaces();
    });
    wsListEl.appendChild(el);
  }
}
loadTabs(); loadWorkspaces();



// --- Избранное ---
async function updateFavorites() {
  const data = await chrome.storage.sync.get('workspaces');
  const favs = (data.workspaces && data.workspaces['Избранное']) || [];
  document.getElementById('fav-count').textContent = `(${favs.length})`;
}

document.getElementById('ws-favorites').addEventListener('click', async () => {
  const data = await chrome.storage.sync.get('workspaces');
  const favs = (data.workspaces && data.workspaces['Избранное']) || [];
  if (favs.length === 0) {
    alert('Избранное пусто. Добавляйте сюда вкладки через контекстное меню (правый клик).');
    return;
  }
  const urls = favs.map(t => t.url).filter(Boolean);
  if (urls.length > 0) { await chrome.windows.create({ url: urls }); window.close(); }
});

// Обновляем счетчик при загрузке
updateFavorites();
