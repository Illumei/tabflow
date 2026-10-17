const searchEl = document.getElementById('search');
const resultsEl = document.getElementById('results');
const clockEl = document.getElementById('clock');
const wsListEl = document.getElementById('ws-list');
const statTotal = document.getElementById('stat-total');
const statDup = document.getElementById('stat-dup');
const btnTheme = document.getElementById('btn-theme');
const crashRecovery = document.getElementById('crash-recovery');

let allTabs = [];

chrome.storage.local.get('theme', ({ theme }) => {
  if (theme === 'light') document.documentElement.setAttribute('data-theme', 'light');
});
btnTheme.addEventListener('click', () => {
  const isLight = document.documentElement.getAttribute('data-theme') === 'light';
  const newTheme = isLight ? 'dark' : 'light';
  document.documentElement.setAttribute('data-theme', newTheme);
  chrome.storage.local.set({ theme: newTheme });
});

setInterval(() => {
  const now = new Date();
  clockEl.textContent = now.toLocaleTimeString('ru-RU', { hour: '2-digit', minute: '2-digit' });
}, 1000);

async function init() {
  allTabs = await chrome.tabs.query({});
  updateStats();
  renderWorkspaces();
  checkCrashRecovery();
}

async function checkCrashRecovery() {
  const { isPro } = await chrome.storage.local.get('isPro');
  if (!isPro) return; // Crash recovery is Pro only
  
  const { lastSession, lastSessionTime } = await chrome.storage.local.get(['lastSession', 'lastSessionTime']);
  if (!lastSession || !lastSessionTime) return;
  if (Date.now() - lastSessionTime > 5 * 60 * 1000 && allTabs.length < lastSession.length) {
    crashRecovery.style.display = 'flex';
    
    document.getElementById('btn-restore').addEventListener('click', async () => {
      const urls = lastSession.map(t => t.url).filter(Boolean);
      if (urls.length > 0) {
        for (const url of urls) { await chrome.tabs.create({ url, active: false }); }
      }
      chrome.storage.local.remove(['lastSession', 'lastSessionTime']);
      crashRecovery.style.display = 'none';
    });

    document.getElementById('btn-dismiss').addEventListener('click', () => {
      chrome.storage.local.remove(['lastSession', 'lastSessionTime']);
      crashRecovery.style.display = 'none';
    });
  }
}

function updateStats() {
  statTotal.textContent = allTabs.length;
  const urls = allTabs.map(t => t.url).filter(Boolean);
  const uniqueUrls = new Set(urls);
  statDup.textContent = urls.length - uniqueUrls.size;
}

function score(query, tab) {
  if (!query) return 1;
  const q = query.toLowerCase();
  const title = (tab.title || '').toLowerCase();
  const url = (tab.url || '').toLowerCase();
  if (title.includes(q)) return 100;
  if (url.includes(q)) return 50;
  return -1;
}

function renderTabs(filteredTabs) {
  resultsEl.innerHTML = '';
  filteredTabs.forEach(tab => {
    const el = document.createElement('div');
    el.className = 'item';
    let icon = tab.favIconUrl;
    if (!icon) { try { icon = `https://www.google.com/s2/favicons?domain=${new URL(tab.url).hostname}&sz=32`; } catch { icon = 'data:image/svg+xml,<svg xmlns="http://www.w3.org/2000/svg"/>'; } }
    el.innerHTML = `<img class="fav" src="${icon}"><div class="meta"><div class="title">${tab.title}</div><div class="url">${tab.url}</div></div>`;
    el.addEventListener('click', () => {
      chrome.tabs.update(tab.id, { active: true });
      chrome.windows.update(tab.windowId, { focused: true });
    });
    resultsEl.appendChild(el);
  });
}

searchEl.addEventListener('input', () => {
  const q = searchEl.value.trim();
  if (!q) { resultsEl.innerHTML = ''; return; }
  const filtered = allTabs.map(t => ({ tab: t, s: score(q, t) })).filter(x => x.s > 0).sort((a, b) => b.s - a.s).slice(0, 8).map(x => x.tab);
  renderTabs(filtered);
});

searchEl.addEventListener('keydown', (e) => {
  if (e.key === 'Enter') {
    const q = searchEl.value.trim();
    if (q && !q.includes(' ') && q.includes('.')) { window.location.href = q.startsWith('http') ? q : `https://${q}`; }
  }
});

async function renderWorkspaces() {
  const data = await chrome.storage.sync.get('workspaces');
  const workspaces = data.workspaces || {};
  wsListEl.innerHTML = '';
  const keys = Object.keys(workspaces);
  if (keys.length === 0) { wsListEl.innerHTML = '<div style="font-size:14px;color:var(--text-muted);">Нет сохранённых сессий.</div>'; return; }
  for (const name of keys) {
    const ws = workspaces[name];
    const el = document.createElement('div');
    el.className = 'ws-item';
    el.innerHTML = `<span>${name} (${ws.length})</span><span class="ws-del" title="Удалить">✕</span>`;
    el.addEventListener('click', async () => {
      const urls = ws.map(t => t.url).filter(Boolean);
      if (urls.length > 0) await chrome.windows.create({ url: urls });
    });
    el.querySelector('.ws-del').addEventListener('click', async (e) => {
      e.stopPropagation(); delete workspaces[name];
      await chrome.storage.sync.set({ workspaces }); chrome.runtime.sendMessage({ type: 'updateContextMenus' }); renderWorkspaces();
    });
    wsListEl.appendChild(el);
  }
}
init();



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
  if (urls.length > 0) await chrome.windows.create({ url: urls });
});

updateFavorites();
