const els = {
  enabled: document.getElementById('enabled'),
  minutes: document.getElementById('minutes'),
  mode: document.getElementById('mode'),
  protectPinned: document.getElementById('protectPinned'),
  protectAudible: document.getElementById('protectAudible'),
  protectGrouped: document.getElementById('protectGrouped'),
  whitelist: document.getElementById('whitelist'),
  save: document.getElementById('save'),
  status: document.getElementById('status'),
  btnTheme: document.getElementById('btn-theme'),
  licenseKey: document.getElementById('licenseKey'),
  licenseStatus: document.getElementById('licenseStatus'),
  proSettings: document.getElementById('pro-settings')
};

chrome.storage.local.get('theme', ({ theme }) => {
  if (theme === 'dark') document.documentElement.setAttribute('data-theme', 'dark');
});
els.btnTheme.addEventListener('click', () => {
  const isDark = document.documentElement.getAttribute('data-theme') === 'dark';
  const newTheme = isDark ? 'light' : 'dark';
  document.documentElement.setAttribute('data-theme', newTheme);
  chrome.storage.local.set({ theme: newTheme });
});

async function checkLicenseUI() {
  const { isPro, currentLicense } = await chrome.storage.local.get(['isPro', 'currentLicense']);
  
  if (isPro) {
    els.licenseStatus.textContent = '✅ Pro версия активирована';
    els.licenseStatus.style.color = '#14B8A6';
    els.licenseKey.value = currentLicense || '';
    els.licenseKey.disabled = true;
    els.licenseKey.style.opacity = '0.6';
    
    // Разблокируем настройки
    els.proSettings.classList.remove('locked');
    els.enabled.disabled = false;
    els.minutes.disabled = false;
    els.mode.disabled = false;
    els.protectPinned.disabled = false;
    els.protectAudible.disabled = false;
    els.protectGrouped.disabled = false;
    els.whitelist.disabled = false;
  } else {
    els.licenseStatus.textContent = '❌ Бесплатная версия (доступны базовые функции)';
    els.licenseStatus.style.color = '#ef4444';
    
    // Оставляем настройки заблокированными
    els.proSettings.classList.add('locked');
  }
}

els.licenseKey.addEventListener('change', async (e) => {
  const key = e.target.value.trim().toUpperCase();
  if (!key) return;

  if (key.startsWith('TABFLOW-PRO-')) {
    await chrome.storage.local.set({ isPro: true, currentLicense: key });
    alert('Лицензия успешно активирована! Все Pro-функции разблокированы.');
    checkLicenseUI();
  } else {
    alert('Неверный ключ. Проверьте правильность ввода (ключ должен начинаться с TABFLOW-PRO-).');
    els.licenseStatus.textContent = '❌ Неверный ключ';
    els.licenseStatus.style.color = '#ef4444';
  }
});

async function load() {
  const s = await chrome.runtime.sendMessage({ type: 'getSettings' });
  els.enabled.checked = s.autoSuspendEnabled;
  els.minutes.value = s.suspendAfterMinutes;
  els.mode.value = s.mode;
  els.protectPinned.checked = s.protectPinned;
  els.protectAudible.checked = s.protectAudible;
  els.protectGrouped.checked = s.protectGrouped;
  els.whitelist.value = s.whitelist.join('\n');
}

els.save.addEventListener('click', async () => {
  const settings = {
    autoSuspendEnabled: els.enabled.checked,
    suspendAfterMinutes: Math.max(1, Number(els.minutes.value) || 30),
    mode: els.mode.value,
    protectPinned: els.protectPinned.checked,
    protectAudible: els.protectAudible.checked,
    protectGrouped: els.protectGrouped.checked,
    whitelist: els.whitelist.value.split('\n').map((s) => s.trim()).filter(Boolean),
  };
  await chrome.runtime.sendMessage({ type: 'setSettings', settings });
  els.status.textContent = 'Сохранено ✓';
  setTimeout(() => (els.status.textContent = ''), 1500);
});

checkLicenseUI();
load();
