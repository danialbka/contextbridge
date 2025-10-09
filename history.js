/* global chrome */

const linksEl = document.getElementById('dayLinks');
const sectionsEl = document.getElementById('daySections');
const loadingEl = document.getElementById('loading');
const emptyEl = document.getElementById('empty');
const refreshBtn = document.getElementById('refreshBtn');
const exportCsvBtn = document.getElementById('exportCsvBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmClear = document.getElementById('confirmClear');
const cancelClear = document.getElementById('cancelClear');
const timelineEl = document.getElementById('timeline');
let confirmOpen = false;
let currentDays = [];
let currentTimeline = [];

const ROLE_OPTIONS = [
  'Therapist',
  'Data Analyst',
  'Recommendation Coach',
  'Shopping Analyst (find best deals)',
  'What Did I Miss Analyser'
];
const roleMenuContexts = new Set();

function createRoleMenuContext(menuEl, toggleEl){
  let open = false;
  const context = {
    open(){
      if (open) return;
      roleMenuContexts.forEach((ctx) => {
        if (ctx !== context) ctx.close();
      });
      open = true;
      menuEl.hidden = false;
      toggleEl.setAttribute('aria-expanded', 'true');
    },
    close(){
      if (!open) return;
      open = false;
      menuEl.hidden = true;
      toggleEl.setAttribute('aria-expanded', 'false');
    },
    isOpen(){
      return open;
    },
    isMenuTarget(target){
      if (!(target instanceof Node)) return false;
      return menuEl.contains(target) || toggleEl.contains(target);
    }
  };
  roleMenuContexts.add(context);
  return context;
}

function closeAllRoleMenus(){
  let closedAny = false;
  roleMenuContexts.forEach((ctx) => {
    if (!ctx.isOpen()) return;
    ctx.close();
    closedAny = true;
  });
  return closedAny;
}

function handleGlobalMenuDismiss(target){
  if (!(target instanceof Node)) return;
  roleMenuContexts.forEach((ctx) => {
    if (!ctx.isOpen()) return;
    if (ctx.isMenuTarget(target)) return;
    ctx.close();
  });
}

function updateExportState({ isLoading = false } = {}){
  if (!exportCsvBtn) return;
  exportCsvBtn.disabled = isLoading || currentDays.length === 0;
}

function setLoading(isLoading){
  loadingEl.hidden = !isLoading;
  updateExportState({ isLoading });
  if (!isLoading && loadingEl) loadingEl.textContent = 'Loading…';
}

function showEmpty(show){
  emptyEl.hidden = !show;
  linksEl.hidden = show;
  if (show){
    currentDays = [];
    updateExportState();
  }
}

function clearView(){
  closeAllRoleMenus();
  roleMenuContexts.clear();
  linksEl.innerHTML = '';
  sectionsEl.innerHTML = '';
}

function renderDays(days){
  clearView();
  currentDays = [];
  updateExportState();
  if (!days.length){
    showEmpty(true);
    return;
  }

  showEmpty(false);
  const sorted = [...days].sort((a,b)=>b.sortValue - a.sortValue);
  currentDays = sorted;
  updateExportState();

  sorted.forEach((day) => {
    const link = document.createElement('a');
    link.href = `#${day.id}`;
    link.textContent = day.label;
    linksEl.appendChild(link);
  });
  linksEl.hidden = false;

  sorted.forEach((day) => {
    sectionsEl.appendChild(buildDaySection(day));
  });
}

function renderTimeline(items){
  if (!timelineEl) return;
  timelineEl.innerHTML = '';
  currentTimeline = [];
  if (!items.length){
    const empty = document.createElement('p');
    empty.className = 'timeline-empty';
    empty.textContent = 'No timeline events captured yet.';
    timelineEl.appendChild(empty);
    return;
  }

  const list = document.createElement('div');
  list.className = 'timeline-list';
  items.forEach((item) => {
    const entry = document.createElement('article');
    entry.className = 'timeline-item';

    const header = document.createElement('header');
    header.className = 'timeline-header';

    const title = document.createElement('h3');
    title.textContent = item.title || 'Untitled';
    header.appendChild(title);

    const meta = document.createElement('div');
    meta.className = 'timeline-meta';
    const metaParts = [item.label];
    if (item.url) metaParts.push(item.url);
    meta.textContent = metaParts.join(' — ');
    header.appendChild(meta);

    entry.appendChild(header);

    if (item.kind === 'screenshot' && item.dataUrl){
      const img = document.createElement('img');
      img.src = item.dataUrl;
      img.alt = `Screenshot taken ${item.label}`;
      img.loading = 'lazy';
      entry.appendChild(img);
    }

    list.appendChild(entry);
    currentTimeline.push(item);
  });

  timelineEl.appendChild(list);
}

function buildDaySection(day){
  const article = document.createElement('article');
  article.className = 'day';
  article.id = day.id;

  const header = document.createElement('header');
  const title = document.createElement('h2');
  title.textContent = day.label;
  header.appendChild(title);

  const controls = document.createElement('div');
  controls.className = 'day-controls';

  const buttons = document.createElement('div');
  buttons.className = 'day-buttons';

  const copySplit = document.createElement('div');
  copySplit.className = 'split-button';

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy Day';
  copyBtn.type = 'button';
  copyBtn.classList.add('split-button-main');

  const copyToggle = document.createElement('button');
  copyToggle.type = 'button';
  copyToggle.className = 'split-button-toggle';
  copyToggle.setAttribute('aria-haspopup', 'true');

  const copyMenuId = `copyRoleMenu-${day.id}`;
  copyToggle.setAttribute('aria-controls', copyMenuId);
  copyToggle.setAttribute('aria-expanded', 'false');

  const copyChevron = document.createElement('span');
  copyChevron.className = 'chevron';
  copyChevron.setAttribute('aria-hidden', 'true');
  copyToggle.appendChild(copyChevron);

  const copySrLabel = document.createElement('span');
  copySrLabel.className = 'sr-only';
  copySrLabel.textContent = 'Copy with role';
  copyToggle.appendChild(copySrLabel);

  const copyRoleMenu = document.createElement('div');
  copyRoleMenu.className = 'split-menu';
  copyRoleMenu.id = copyMenuId;
  copyRoleMenu.setAttribute('role', 'menu');
  copyRoleMenu.hidden = true;

  ROLE_OPTIONS.forEach((role) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'split-menu-item';
    item.dataset.role = role;
    item.textContent = role;
    item.setAttribute('role', 'menuitem');
    copyRoleMenu.appendChild(item);
  });

  copySplit.appendChild(copyBtn);
  copySplit.appendChild(copyToggle);
  copySplit.appendChild(copyRoleMenu);

  const sendSplit = document.createElement('div');
  sendSplit.className = 'split-button';

  const sendBtn = document.createElement('button');
  sendBtn.textContent = 'Send to ChatGPT';
  sendBtn.type = 'button';
  sendBtn.classList.add('ghost', 'split-button-main');

  const sendToggle = document.createElement('button');
  sendToggle.type = 'button';
  sendToggle.className = 'split-button-toggle ghost';
  sendToggle.setAttribute('aria-haspopup', 'true');

  const sendMenuId = `sendRoleMenu-${day.id}`;
  sendToggle.setAttribute('aria-controls', sendMenuId);
  sendToggle.setAttribute('aria-expanded', 'false');

  const sendChevron = document.createElement('span');
  sendChevron.className = 'chevron';
  sendChevron.setAttribute('aria-hidden', 'true');
  sendToggle.appendChild(sendChevron);

  const sendSrLabel = document.createElement('span');
  sendSrLabel.className = 'sr-only';
  sendSrLabel.textContent = 'Send with role';
  sendToggle.appendChild(sendSrLabel);

  const sendRoleMenu = document.createElement('div');
  sendRoleMenu.className = 'split-menu';
  sendRoleMenu.id = sendMenuId;
  sendRoleMenu.setAttribute('role', 'menu');
  sendRoleMenu.hidden = true;

  ROLE_OPTIONS.forEach((role) => {
    const item = document.createElement('button');
    item.type = 'button';
    item.className = 'split-menu-item';
    item.dataset.role = role;
    item.textContent = role;
    item.setAttribute('role', 'menuitem');
    sendRoleMenu.appendChild(item);
  });

  sendSplit.appendChild(sendBtn);
  sendSplit.appendChild(sendToggle);
  sendSplit.appendChild(sendRoleMenu);

  const status = document.createElement('span');
  status.className = 'action-status';
  status.textContent = '';

  let statusTimeout;
  function setStatus(message, { autoClear = true } = {}){
    clearTimeout(statusTimeout);
    status.textContent = message;
    if (autoClear && message){
      statusTimeout = setTimeout(() => { status.textContent = ''; }, 1800);
    }
  }

  const copyMenuContext = createRoleMenuContext(copyRoleMenu, copyToggle);
  const sendMenuContext = createRoleMenuContext(sendRoleMenu, sendToggle);

  function buildDayText(role){
    const prefix = role ? `[Role: ${role}]\n\n` : '';
    return `${prefix}${day.text}`;
  }

  async function copyDay(role){
    setStatus(role ? `Copying as ${role}…` : 'Copying…', { autoClear: false });
    try {
      await navigator.clipboard.writeText(buildDayText(role));
      setStatus(role ? `Copied as ${role}` : 'Copied');
    } catch (e){
      console.error('Copy failed', e);
      setStatus('Copy failed');
    }
  }

  copyBtn.addEventListener('click', async () => {
    copyMenuContext.close();
    await copyDay();
  });

  async function sendDay(role){
    setStatus(role ? `Sending as ${role}…` : 'Sending…', { autoClear: false });
    const text = buildDayText(role);
    try {
      await navigator.clipboard.writeText(text);
    } catch (e) {
      console.debug('Clipboard write failed (non-fatal)', e);
    }
    chrome.runtime.sendMessage({ type: 'OPEN_AND_SEND', text }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        console.error('Send failed', chrome.runtime.lastError || resp);
        setStatus('Send failed');
        return;
      }
      setStatus(role ? `Sent as ${role}` : 'Sent');
    });
  }

  sendBtn.addEventListener('click', async () => {
    sendMenuContext.close();
    await sendDay();
  });

  copyToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    if (copyMenuContext.isOpen()) copyMenuContext.close();
    else copyMenuContext.open();
  });

  copyRoleMenu.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    event.stopPropagation();
    const role = target.dataset.role;
    copyMenuContext.close();
    await copyDay(role);
  });

  sendToggle.addEventListener('click', (event) => {
    event.stopPropagation();
    if (sendMenuContext.isOpen()) sendMenuContext.close();
    else sendMenuContext.open();
  });

  sendRoleMenu.addEventListener('click', async (event) => {
    const target = event.target;
    if (!(target instanceof HTMLButtonElement)) return;
    event.stopPropagation();
    const role = target.dataset.role;
    sendMenuContext.close();
    await sendDay(role);
  });

  buttons.appendChild(copySplit);
  buttons.appendChild(sendSplit);
  controls.appendChild(buttons);
  controls.appendChild(status);
  header.appendChild(controls);
  article.appendChild(header);

  const pre = document.createElement('pre');
  pre.textContent = day.lines.join('\n');
  article.appendChild(pre);

  return article;
}

function parseHistoryLine(line){
  const result = { time: '', title: '', url: '', notes: '' };
  if (typeof line !== 'string'){
    result.notes = String(line ?? '');
    return result;
  }

  const prefix = '- [';
  if (!line.startsWith(prefix)){
    result.notes = line.trim();
    return result;
  }

  const closingBracketIdx = line.indexOf('] ');
  if (closingBracketIdx === -1){
    result.notes = line.trim();
    return result;
  }

  result.time = line.slice(prefix.length, closingBracketIdx).trim();
  const remainder = line.slice(closingBracketIdx + 2).trim();
  const separatorIdx = remainder.lastIndexOf(' — ');
  if (separatorIdx === -1){
    result.title = remainder.trim();
    return result;
  }

  result.title = remainder.slice(0, separatorIdx).trim();
  const tail = remainder.slice(separatorIdx + 3).trim();
  const searchIdx = tail.indexOf(' [search:');
  if (searchIdx !== -1){
    result.url = tail.slice(0, searchIdx).trim();
    result.notes = tail.slice(searchIdx).trim();
  } else {
    result.url = tail;
  }

  return result;
}

function exportHistoryCsv(){
  if (!currentDays.length){
    window.alert('No history to export yet.');
    return;
  }

  const header = ['Day', 'Time', 'Title', 'URL', 'Notes'];
  const rows = [header];
  currentDays.forEach((day) => {
    day.lines.forEach((line) => {
      const parsed = parseHistoryLine(line);
      rows.push([
        day.label,
        parsed.time,
        parsed.title,
        parsed.url,
        parsed.notes
      ]);
    });
  });

  const csv = rows.map((row) => row.map((value) => {
    const text = value == null ? '' : String(value);
    return `"${text.replace(/"/g, '""')}"`;
  }).join(',')).join('\r\n');

  const blob = new Blob(['\ufeff', csv], { type: 'text/csv;charset=utf-8;' });
  const url = URL.createObjectURL(blob);
  const a = document.createElement('a');
  a.href = url;
  const today = new Date().toISOString().slice(0, 10);
  a.download = `context-copy-history-${today}.csv`;
  document.body.appendChild(a);
  a.click();
  document.body.removeChild(a);
  URL.revokeObjectURL(url);
}

function decorateTimeline(rawScreenshots){
  if (!Array.isArray(rawScreenshots)) return [];
  return rawScreenshots
    .slice()
    .sort((a,b)=>b.ts - a.ts)
    .map((item) => ({
      ...item,
      kind: 'screenshot',
      label: new Date(item.ts).toLocaleString()
    }));
}

function loadDays(){
  setLoading(true);
  chrome.runtime.sendMessage({ type: 'GET_HISTORY_BY_DAY' }, (resp) => {
    setLoading(false);
    if (chrome.runtime.lastError){
      console.error('History load error', chrome.runtime.lastError);
      emptyEl.textContent = 'Unable to load history. Please reopen this page.';
      showEmpty(true);
      return;
    }
    if (!resp?.ok){
      emptyEl.textContent = 'Unable to load history. Please reopen this page.';
      showEmpty(true);
      return;
    }
    renderDays(resp.days || []);
    renderTimeline(decorateTimeline(resp.screenshots));
  });
}

function showConfirm(){
  if (confirmOpen) return;
  confirmOpen = true;
  confirmOverlay.classList.add('open');
  confirmOverlay.setAttribute('aria-hidden', 'false');
}

function hideConfirm(){
  if (!confirmOpen) return;
  confirmOpen = false;
  confirmOverlay.classList.remove('open');
  confirmOverlay.setAttribute('aria-hidden', 'true');
}

async function clearHistoryWindow(){
  setLoading(true);
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'CLEAR_HISTORY_WINDOW' }, (resp) => {
      setLoading(false);
      const err = chrome.runtime.lastError;
      if (err || !resp?.ok) {
        console.error('History clear error', err || resp);
        emptyEl.textContent = 'Unable to clear history right now.';
        showEmpty(true);
      }
      resolve();
      loadDays();
    });
  });
}

refreshBtn.addEventListener('click', () => loadDays());
if (exportCsvBtn) exportCsvBtn.addEventListener('click', () => exportHistoryCsv());
clearHistoryBtn.addEventListener('click', () => showConfirm());
cancelClear.addEventListener('click', () => hideConfirm());
confirmOverlay.addEventListener('click', (e) => { if (e.target === confirmOverlay) hideConfirm(); });
document.addEventListener('click', (event) => { handleGlobalMenuDismiss(event.target); });
document.addEventListener('focusin', (event) => { handleGlobalMenuDismiss(event.target); });
document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape'){
    const menuClosed = closeAllRoleMenus();
    if (confirmOpen) hideConfirm();
    if (menuClosed) e.stopPropagation();
  }
});
confirmClear.addEventListener('click', async () => {
  hideConfirm();
  await clearHistoryWindow();
});

document.addEventListener('DOMContentLoaded', () => loadDays());
