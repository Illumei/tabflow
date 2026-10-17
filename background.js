const DEFAULTS = {
  autoSuspendEnabled: true, suspendAfterMinutes: 30, mode: 'discard',
  whitelist: ['mail.google.com', 'calendar.google.com'],
  protectPinned: true, protectAudible: true, protectGrouped: false,
};
const ALARM_NAME = 'tabflow-check';
const SESSION_ALARM = 'tabflow-session-save';
const ACTIVITY_KEY = 'tabActivity';

async function getSettings() {
  const { settings } = await chrome.storage.sync.get('settings');
  return { ...DEFAULTS, ...(settings || {}) };
}
async function setSettings(partial) {
  const current = await getSettings();
  const next = { ...current, ...partial };
  await chrome.storage.sync.set({ settings: next });
  await rescheduleAlarm();
  return next;
}
async function getActivity() {
  const data = await chrome.storage.local.get(ACTIVITY_KEY);
  return data[ACTIVITY_KEY] || {};
}
async function setActivity(activity) {
  await chrome.storage.local.set({ [ACTIVITY_KEY]: activity });
}
async function touchTab(tabId) {
  const activity = await getActivity();
  activity[tabId] = Date.now();
  await setActivity(activity);
  updateBadge(); // Обновляем бейдж при переключении
}
async function forgetTab(tabId) {
  const activity = await getActivity();
  if (tabId in activity) {
    delete activity[tabId];
    await setActivity(activity);
  }
  updateBadge(); // Обновляем бейдж при закрытии
}

// --- Контекстное меню ---
async function updateContextMenus() {
  console.log("[TabFlow] Обновляем контекстное меню...");
  try {
    const { workspaces = {} } = await chrome.storage.sync.get('workspaces');
    
    await chrome.contextMenus.removeAll(); 
    
    chrome.contextMenus.create({
      id: "tabflow_root",
      title: "TabFlow: Сохранить в...",
      contexts: ["page", "tab", "link", "selection", "image"]
    });
    
    // Всегда добавляем "Избранное" первым
    chrome.contextMenus.create({
      id: "ws_Избранное",
      parentId: "tabflow_root",
      title: "⭐ Избранное",
      contexts: ["page", "tab", "link", "selection", "image"]
    });

    // Добавляем остальные сессии (кроме Избранного, если оно есть в списке)
    const keys = Object.keys(workspaces).filter(k => k !== 'Избранное');
    keys.forEach(name => {
      chrome.contextMenus.create({
        id: `ws_${name}`,
        parentId: "tabflow_root",
        title: name,
        contexts: ["page", "tab", "link", "selection", "image"]
      });
    });
  } catch (err) {
    console.error("[TabFlow] Ошибка при обновлении меню:", err);
  }
}

chrome.contextMenus.onClicked.addListener(async (info, tab) => {
  if (info.menuItemId.startsWith('ws_')) {
    let wsName = info.menuItemId.replace('ws_', '');
    if (wsName === 'default') wsName = 'Избранное';
    
    const { workspaces = {} } = await chrome.storage.sync.get('workspaces');
    if (!workspaces[wsName]) workspaces[wsName] = [];
    
    // Проверка на дубликат
    if (!workspaces[wsName].some(t => t.url === tab.url)) {
      workspaces[wsName].push({ url: tab.url, title: tab.title });
      await chrome.storage.sync.set({ workspaces });
    }
  }
});

// --- Бейдж (Tab Debt) ---
async function updateBadge() {
  const { isPro } = await chrome.storage.local.get('isPro');
  if (!isPro) {
    chrome.action.setBadgeText({ text: '' });
    return;
  }
  const activity = await getActivity();
  const now = Date.now();
  const TWO_HOURS = 2 * 60 * 60 * 1000;
  let debtCount = 0;
  const tabs = await chrome.tabs.query({});
  
  for (const tab of tabs) {
    if (tab.active) continue;
    const last = activity[tab.id] || now;
    if (now - last > TWO_HOURS) debtCount++;
  }
  
  if (debtCount > 0) {
    chrome.action.setBadgeText({ text: debtCount.toString() });
    chrome.action.setBadgeBackgroundColor({ color: '#ef4444' }); // Красный
  } else {
    chrome.action.setBadgeText({ text: '' });
  }
}

// --- Инициализация ---
chrome.runtime.onInstalled.addListener(async () => {
  const settings = await getSettings();
  await chrome.storage.sync.set({ settings });
  await seedActivity();
  await rescheduleAlarm();
  chrome.alarms.create(SESSION_ALARM, { periodInMinutes: 5 });
  updateContextMenus();
});

chrome.runtime.onStartup.addListener(async () => {
  await seedActivity();
  await rescheduleAlarm();
  chrome.alarms.create(SESSION_ALARM, { periodInMinutes: 5 });
  updateContextMenus();
});

async function seedActivity() {
  const tabs = await chrome.tabs.query({});
  const activity = await getActivity();
  const now = Date.now();
  const validIds = new Set();
  for (const tab of tabs) {
    validIds.add(tab.id);
    if (!(tab.id in activity)) activity[tab.id] = now;
  }
  for (const id of Object.keys(activity)) {
    if (!validIds.has(Number(id))) delete activity[id];
  }
  await setActivity(activity);
  updateBadge();
}

chrome.tabs.onActivated.addListener(({ tabId }) => touchTab(tabId));
chrome.tabs.onCreated.addListener((tab) => tab.id && touchTab(tab.id));
chrome.tabs.onRemoved.addListener((tabId) => forgetTab(tabId));
chrome.tabs.onUpdated.addListener((tabId, changeInfo) => {
  if (changeInfo.status === 'complete' || changeInfo.url) touchTab(tabId);
});

async function rescheduleAlarm() {
  const settings = await getSettings();
  await chrome.alarms.clear(ALARM_NAME);
  const { isPro } = await chrome.storage.local.get('isPro');
  if (settings.autoSuspendEnabled && isPro) {
    chrome.alarms.create(ALARM_NAME, { periodInMinutes: 1 });
  }
}

chrome.alarms.onAlarm.addListener((alarm) => {
  if (alarm.name === ALARM_NAME) runSweep();
  if (alarm.name === SESSION_ALARM) { saveCurrentSession(); updateBadge(); }
});

async function saveCurrentSession() {
  const { isPro } = await chrome.storage.local.get('isPro');
  if (!isPro) return;
  const tabs = await chrome.tabs.query({});
  const validTabs = tabs.filter(t => t.url && t.url.startsWith('http'));
  if (validTabs.length > 0) {
    await chrome.storage.local.set({ lastSession: validTabs.map(t => ({ url: t.url, title: t.title })) });
    await chrome.storage.local.set({ lastSessionTime: Date.now() });
  }
}

function domainOf(url) { try { return new URL(url).hostname; } catch { return ''; } }
function matchesWhitelist(url, whitelist) {
  const host = domainOf(url);
  if (!host) return false;
  return whitelist.some((w) => host === w || host.endsWith('.' + w));
}

async function runSweep(isManual = false) {
  const settings = await getSettings();
  const { isPro } = await chrome.storage.local.get('isPro');
  if (!isManual && (!settings.autoSuspendEnabled || !isPro)) return;
  
  const thresholdMs = settings.suspendAfterMinutes * 60 * 1000;
  const now = Date.now();
  const activity = await getActivity();
  const tabs = await chrome.tabs.query({});
  for (const tab of tabs) {
    if (!tab.id || tab.active) continue;
    if (settings.protectPinned && tab.pinned) continue;
    if (settings.protectAudible && tab.audible) continue;
    if (settings.protectGrouped && tab.groupId !== -1) continue;
    if (matchesWhitelist(tab.url || '', settings.whitelist)) continue;
    if (tab.discarded) continue;
    const last = activity[tab.id] || now;
    if (now - last < thresholdMs) continue;
    try {
      if (settings.mode === 'close') await chrome.tabs.remove(tab.id);
      else await chrome.tabs.discard(tab.id);
    } catch (e) { console.warn('[TabFlow] sweep error', tab.id, e); }
  }
}

chrome.runtime.onMessage.addListener((msg, _sender, sendResponse) => {
  (async () => {
    if (msg.type === 'getSettings') sendResponse(await getSettings());
    else if (msg.type === 'setSettings') sendResponse(await setSettings(msg.settings));
    else if (msg.type === 'suspendInactiveNow') { await runSweep(true); sendResponse({ ok: true }); }
    else if (msg.type === 'getActivity') sendResponse(await getActivity());
    else if (msg.type === 'saveSessionNow') { await saveCurrentSession(); sendResponse({ ok: true }); }
    else if (msg.type === 'updateContextMenus') { updateContextMenus(); sendResponse({ ok: true }); }
    else if (msg.type === 'forceBadgeUpdate') { updateBadge(); sendResponse({ ok: true }); }
  })();
  return true;
});

chrome.commands.onCommand.addListener(async (command) => {
  if (command === 'open-search') {
    try { await chrome.action.openPopup(); } catch { chrome.tabs.create({ url: chrome.runtime.getURL('popup.html') }); }
  }
});



// Сразу при старте
updateContextMenus();

