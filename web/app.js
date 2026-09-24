// 存取憑證只留在目前瀏覽器分頁；移除網址片段，避免被當作一般書籤分享。
let token = location.hash.slice(1) || sessionStorage.getItem('autoupdomain-token');
if (location.hash) {
  sessionStorage.setItem('autoupdomain-token', token);
  history.replaceState(null, '', '/');
}
const $ = (id) => document.getElementById(id);
const form = $('settings');

// 眼睛按鈕僅作用於目前輸入值，不向後端取回已保存的密鑰。
function concealSecrets() {
  for (const button of document.querySelectorAll('[data-secret]')) {
    const input = document.getElementById(button.dataset.secret);
    input.type = 'password';
    button.setAttribute('aria-pressed', 'false');
    button.setAttribute('aria-label', button.dataset.showLabel);
    button.title = button.dataset.showLabel;
  }
}
for (const button of document.querySelectorAll('[data-secret]')) {
  button.dataset.showLabel = button.getAttribute('aria-label');
  button.addEventListener('click', () => {
    const input = document.getElementById(button.dataset.secret);
    const visible = input.type === 'password';
    input.type = visible ? 'text' : 'password';
    button.setAttribute('aria-pressed', String(visible));
    const label = visible
      ? button.dataset.showLabel.replace('顯示', '隱藏')
      : button.dataset.showLabel;
    button.setAttribute('aria-label', label);
    button.title = label;
  });
}
document.addEventListener('visibilitychange', () => {
  if (document.hidden) concealSecrets();
});

let state,
  initialized = false,
  busy = false;
let domainView = 'truncate',
  domainLabels = {},
  nextDomainLabel = 1,
  logPaused = false,
  logEntries = [],
  logFingerprint = '';
// 網域顯示：截斷 / 完整 / 隱藏（直播模式）。三態互斥，由同一組分段控制切換。
const DOMAIN_VIEW_KEY = 'autoupdomain-domain-view';
const LEGACY_TRUNCATED_KEY = 'autoupdomain-domain-truncated';
const LEGACY_LIVE_KEY = 'autoupdomain-domain-live-mode';
const DOMAIN_LABELS_KEY = 'autoupdomain-domain-labels';
function loadDomainPreferences() {
  const view = localStorage.getItem(DOMAIN_VIEW_KEY);
  if (view === 'truncate' || view === 'full' || view === 'hidden') domainView = view;
  // 舊版是兩個獨立開關，轉換成等價的三態偏好。
  else if (localStorage.getItem(LEGACY_LIVE_KEY) === 'true') domainView = 'hidden';
  else if (localStorage.getItem(LEGACY_TRUNCATED_KEY) === 'false') domainView = 'full';
  try {
    domainLabels = JSON.parse(localStorage.getItem(DOMAIN_LABELS_KEY)) || {};
  } catch {
    domainLabels = {};
  }
  nextDomainLabel = Object.values(domainLabels).reduce((max, value) => Math.max(max, value), 0) + 1;
}
// 隱藏模式只顯示固定編號，避免畫面分享時洩漏網域；編號一旦指派即固定不變。
function domainLabel(id) {
  const key = String(id);
  if (!(key in domainLabels)) {
    domainLabels[key] = nextDomainLabel++;
    localStorage.setItem(DOMAIN_LABELS_KEY, JSON.stringify(domainLabels));
  }
  return domainLabels[key];
}
function setDomainView(view) {
  domainView = view;
  localStorage.setItem(DOMAIN_VIEW_KEY, view);
  render();
}
// 隱藏模式下把日誌中的完整網域換成編號，避免控制台洩漏名稱；長網域先替換以免被短網域截斷。
function maskDomainNames(message) {
  if (domainView !== 'hidden' || !state) return message;
  let text = String(message);
  for (const domain of [...state.domains].sort(
    (a, b) => (b.full_domain || '').length - (a.full_domain || '').length,
  ))
    if (domain.full_domain)
      text = text.split(domain.full_domain).join('網域 #' + domainLabel(domain.id));
  return text;
}
loadDomainPreferences();
const levelNames = { info: '資訊', success: '成功', warning: '警告', error: '錯誤' };
// 暫停的是控制台畫面，服務仍繼續工作；恢復時載入最新的有限筆數紀錄。
function renderLogs() {
  if (!logPaused) logEntries = state.history.slice().reverse();
  const filter = $('log-filter').value;
  const visible = logEntries
    .filter(
      (item) =>
        filter === 'all' ||
        (filter === 'issues' ? ['warning', 'error'].includes(item.level) : item.level === 'error'),
    )
    .map((item) => ({ ...item, message: maskDomainNames(item.message) }));
  const fingerprint = JSON.stringify(visible);
  if (fingerprint !== logFingerprint) {
    const output = $('console-output'),
      scroll = output.scrollTop;
    const rows = visible.map((item) => {
      const li = document.createElement('li');
      li.dataset.level = item.level;
      const time = document.createElement('time');
      time.textContent = date(item.time);
      const level = document.createElement('span');
      level.className = 'log-level';
      level.textContent = levelNames[item.level] || item.level;
      const text = document.createElement('span');
      text.textContent = item.message;
      li.append(time, level, text);
      return li;
    });
    $('history').replaceChildren(...rows);
    $('log-empty').hidden = visible.length > 0;
    output.scrollTop = $('log-follow').checked ? output.scrollHeight : scroll;
    logFingerprint = fingerprint;
  }
  $('log-status').textContent = logPaused
    ? '畫面更新已暫停 · 任務持續執行'
    : '即時更新 · ' + logEntries.length + ' 筆';
}
$('log-filter').onchange = () => {
  if (state) renderLogs();
};
$('log-pause').onclick = () => {
  logPaused = !logPaused;
  $('log-pause').textContent = logPaused ? '繼續更新' : '暫停更新';
  $('log-pause').setAttribute('aria-pressed', String(logPaused));
  if (state) renderLogs();
};
$('log-follow').onchange = () => {
  if ($('log-follow').checked) $('console-output').scrollTop = $('console-output').scrollHeight;
};
$('log-download').onclick = () => {
  const text = logEntries
    .map(
      (item) =>
        '[' +
        item.time +
        '] [' +
        (levelNames[item.level] || item.level) +
        '] ' +
        maskDomainNames(item.message),
    )
    .join('\n');
  const url = URL.createObjectURL(new Blob([text], { type: 'text/plain;charset=utf-8' }));
  const link = document.createElement('a');
  link.href = url;
  link.download = 'autoupdomain-log.txt';
  link.click();
  setTimeout(() => URL.revokeObjectURL(url), 1000);
};
$('log-clear').onclick = () => {
  if (!confirm('確定要清除所有日誌嗎？清除後無法復原。')) return;
  action(async () => {
    await api('logs/clear', {});
    message('日誌已清除');
  });
};
let previousUnit = 'days';
function setIntervalLimits() {
  const days = form.elements.intervalUnit.value === 'days';
  form.elements.intervalValue.max = days ? '90' : '2160';
  form.elements.intervalValue.step = days ? '1' : 'any';
}
form.elements.intervalUnit.onchange = () => {
  const unit = form.elements.intervalUnit.value,
    value = Number(form.elements.intervalValue.value);
  if (Number.isFinite(value) && value > 0 && previousUnit !== unit)
    form.elements.intervalValue.value =
      unit === 'days' ? Math.max(1, Math.ceil(value / 24)) : value * 24;
  previousUnit = unit;
  setIntervalLimits();
};
// 固定格式，避免 toLocaleString 隨系統地區變動，也讓摘要與表格一致。
const date = (value) => {
  if (!value) return '尚無紀錄';
  const parsed = new Date(value);
  if (Number.isNaN(parsed.getTime())) return String(value);
  const pad = (number) => String(number).padStart(2, '0');
  return (
    parsed.getFullYear() +
    '-' +
    pad(parsed.getMonth() + 1) +
    '-' +
    pad(parsed.getDate()) +
    ' ' +
    pad(parsed.getHours()) +
    ':' +
    pad(parsed.getMinutes()) +
    ':' +
    pad(parsed.getSeconds())
  );
};
const message = (text) => {
  $('message').textContent = text;
};
async function api(path, body) {
  const response = await fetch('/api/' + path, {
    method: body === undefined ? 'GET' : 'POST',
    headers: { Authorization: 'Bearer ' + token, 'Content-Type': 'application/json' },
    ...(body === undefined ? {} : { body: JSON.stringify(body) }),
  });
  const result = await response.json();
  if (!response.ok) throw new Error(result.error || '操作失敗');
  return result;
}
function render() {
  $('health').textContent = state.running
    ? '檢查中'
    : state.settings.paused
      ? '排程已暫停'
      : !state.hasApiKey || !state.hasApiSecret
        ? '等待設定'
        : state.lastError
          ? '需要處理'
          : '背景監看中';
  $('last').textContent = date(state.lastSuccessAt);
  $('next').textContent = state.settings.paused
    ? '已暫停'
    : !state.hasApiKey || !state.hasApiSecret
      ? '等待設定'
      : state.nextRunAt
        ? date(state.nextRunAt)
        : '即將檢查';
  $('count').textContent = state.domains.length;
  $('error').textContent = state.lastError || '';
  $('run').disabled = state.running || busy;
  $('pause').disabled = state.running || busy;
  $('pause').textContent = state.settings.paused ? '恢復排程' : '暫停排程';
  for (const button of document.querySelectorAll('[data-view]'))
    button.setAttribute('aria-pressed', String(button.dataset.view === domainView));
  $('domains').replaceChildren();
  for (const domain of state.domains) {
    const tr = document.createElement('tr');
    const domainTd = document.createElement('td');
    const fullDomain = domain.full_domain;
    domainTd.textContent =
      domainView === 'hidden'
        ? '網域 #' + domainLabel(domain.id)
        : domainView === 'truncate' && fullDomain.length > 12
          ? fullDomain.substring(0, 12) + '...'
          : fullDomain;
    tr.append(domainTd);
    const daysLeft = Math.floor((Date.parse(domain.expires_at) - Date.now()) / 86400000);
    const daysTd = document.createElement('td');
    daysTd.className = 'days';
    if (daysLeft <= 7) daysTd.classList.add('days-critical');
    else if (daysLeft <= state.settings.renewBeforeDays) daysTd.classList.add('days-warning');
    daysTd.textContent = daysLeft + ' 天';
    tr.append(daysTd);
    const expiryTd = document.createElement('td');
    expiryTd.textContent = date(domain.expires_at);
    tr.append(expiryTd);
    const statusTd = document.createElement('td');
    const badge = document.createElement('span');
    badge.className = 'status ' + (domain.status === '正常' ? 'status-ok' : 'status-warn');
    badge.textContent = domain.status;
    statusTd.append(badge);
    tr.append(statusTd);
    $('domains').append(tr);
  }
  $('empty').hidden = state.domains.length > 0;
  renderLogs();
  if (!initialized) {
    form.elements.notificationMode.value = state.settings.notificationMode;
    form.elements.intervalUnit.value = state.settings.intervalUnit;
    previousUnit = state.settings.intervalUnit;
    form.elements.intervalValue.value =
      state.settings.intervalHours / (previousUnit === 'days' ? 24 : 1);
    form.elements.renewBeforeDays.value = state.settings.renewBeforeDays;
    setIntervalLimits();
    for (const key of ['nativeNotifications', 'barkEnabled', 'launchAtLogin'])
      form.elements[key].checked = state.settings[key];
    for (const [key, exists] of [
      ['apiKey', state.hasApiKey],
      ['apiSecret', state.hasApiSecret],
      ['barkUrl', state.hasBarkUrl],
    ])
      form.elements[key].placeholder = exists ? '已儲存，留白保留' : '尚未設定';
    form.elements.launchAtLogin.disabled = !state.capabilities.login;
    $('capabilities').textContent = state.capabilities.note || '';
    initialized = true;
  }
}
async function refresh() {
  try {
    state = await api('state');
    render();
  } catch (error) {
    $('health').textContent = '連線中斷';
    $('log-status').textContent = '連線中斷 · 保留上次日誌';
    message(error.message);
  }
}
async function action(work) {
  if (busy) return;
  busy = true;
  try {
    await work();
    await refresh();
  } catch (error) {
    message(error.message);
  } finally {
    busy = false;
    if (state) render();
  }
}
$('run').onclick = () =>
  action(async () => {
    await api('run', {});
    message('已開始檢查，結果會自動更新。');
  });
$('pause').onclick = () =>
  action(async () => {
    await api('settings', { paused: !state.settings.paused });
    message('排程設定已更新');
  });
for (const button of document.querySelectorAll('[data-view]'))
  button.onclick = () => setDomainView(button.dataset.view);
$('test').onclick = () =>
  action(async () => {
    const result = await api('notification-test', {});
    message(
      result.failures.length
        ? result.failures.join('；')
        : '已交付通知管道；實際顯示仍取決於系統通知權限與勿擾設定。',
    );
  });
form.onsubmit = (event) => {
  event.preventDefault();
  action(async () => {
    const config = { notificationMode: form.elements.notificationMode.value };
    // 表單可使用天或小時；服務統一用小時計算下次執行時間。
    config.intervalUnit = form.elements.intervalUnit.value;
    config.intervalHours =
      Number(form.elements.intervalValue.value) * (config.intervalUnit === 'days' ? 24 : 1);
    config.renewBeforeDays = Number(form.elements.renewBeforeDays.value);
    for (const key of ['nativeNotifications', 'barkEnabled', 'launchAtLogin'])
      config[key] = form.elements[key].checked;
    for (const key of ['apiKey', 'apiSecret', 'barkUrl'])
      if (form.elements[key].value.trim()) config[key] = form.elements[key].value.trim();
    await api('settings', config);
    for (const key of ['apiKey', 'apiSecret', 'barkUrl']) form.elements[key].value = '';
    concealSecrets();
    initialized = false;
    message('設定已儲存');
  });
};
refresh();
setInterval(refresh, 1000);
