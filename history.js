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
let confirmOpen = false;
let currentDays = [];
const canUseClipboard = !!(navigator.clipboard && navigator.clipboard.writeText);
const copyFeedbackTimers = new WeakMap();

function setCopyFeedback(button, message){
  if (!button) return;
  const original = button.dataset.originalLabel || button.textContent;
  if (!button.dataset.originalLabel){
    button.dataset.originalLabel = original;
  }
  button.textContent = message;
  button.disabled = true;
  if (copyFeedbackTimers.has(button)){
    clearTimeout(copyFeedbackTimers.get(button));
  }
  const timeout = setTimeout(() => {
    button.textContent = button.dataset.originalLabel || original || 'Copy';
    button.disabled = false;
    copyFeedbackTimers.delete(button);
  }, 1500);
  copyFeedbackTimers.set(button, timeout);
}

async function copyTextToClipboard(text, button){
  if (!canUseClipboard || !text) return;
  try {
    await navigator.clipboard.writeText(text);
    setCopyFeedback(button, 'Copied!');
  } catch (error){
    console.error('Copy failed', error);
    setCopyFeedback(button, 'Copy failed');
  }
}

function createPreBlock(text){
  const pre = document.createElement('pre');
  pre.textContent = text;
  return pre;
}

function createDebugBlock({ title, subtitle, copyText, copyLabel = 'Copy', content }){
  const block = document.createElement('div');
  block.className = 'debug-block';

  const header = document.createElement('div');
  header.className = 'debug-block-header';

  const heading = document.createElement('h3');
  heading.textContent = title;
  header.appendChild(heading);

  if (copyText && canUseClipboard){
    const controls = document.createElement('div');
    controls.className = 'debug-block-controls';
    const copyBtn = document.createElement('button');
    copyBtn.type = 'button';
    copyBtn.className = 'ghost debug-copy';
    copyBtn.textContent = copyLabel;
    copyBtn.addEventListener('click', async () => {
      await copyTextToClipboard(copyText, copyBtn);
    });
    controls.appendChild(copyBtn);
    header.appendChild(controls);
  }

  block.appendChild(header);

  if (subtitle){
    const note = document.createElement('p');
    note.className = 'debug-note';
    note.textContent = subtitle;
    block.appendChild(note);
  }

  if (content){
    block.appendChild(content);
  }

  return block;
}

function stableJsonStringify(value){
  if (Array.isArray(value)){
    return `[${value.map((item) => stableJsonStringify(item)).join(',')}]`;
  }
  if (value && typeof value === 'object'){
    const keys = Object.keys(value).sort();
    return `{${keys.map((key) => `${JSON.stringify(key)}:${stableJsonStringify(value[key])}`).join(',')}}`;
  }
  return JSON.stringify(value);
}

function mergeTimelineEvents(primaryEvents = [], secondaryEvents = []){
  const merged = [];
  const seen = new Set();
  const pushEvent = (event) => {
    if (!event || typeof event !== 'object') return;
    const clone = JSON.parse(JSON.stringify(event));
    const key = stableJsonStringify(clone);
    if (seen.has(key)) return;
    seen.add(key);
    merged.push(clone);
  };
  primaryEvents.forEach(pushEvent);
  secondaryEvents.forEach(pushEvent);
  merged.sort((a, b) => {
    const aTs = Number(a.ts) || 0;
    const bTs = Number(b.ts) || 0;
    return aTs - bTs;
  });
  return merged;
}

function safeParseJson(text){
  if (!text) return null;
  try {
    return JSON.parse(text);
  } catch (error){
    console.error('Developer debug JSON parse failed', error);
    return null;
  }
}

function createGraphSummary(summary){
  if (!summary) return null;
  const wrapper = document.createElement('div');
  wrapper.className = 'debug-summary';

  const stats = document.createElement('p');
  stats.className = 'debug-summary-stats';
  stats.textContent = `Pages: ${summary.pageCount ?? 0} • Nodes: ${summary.nodeCount ?? 0}`;
  wrapper.appendChild(stats);

  if (Array.isArray(summary.topPages) && summary.topPages.length){
    const list = document.createElement('ul');
    list.className = 'debug-summary-list';
    summary.topPages.slice(0, 5).forEach((page) => {
      const item = document.createElement('li');
      const label = page.title ? `${page.title} — ${page.url}` : page.url;
      item.textContent = `${label} (${page.nodeCount ?? 0} nodes)`;
      list.appendChild(item);
    });
    wrapper.appendChild(list);
  }

  return wrapper;
}

function prepareDeveloperDebug(debug = {}){
  if (!debug || typeof debug !== 'object') return null;
  const eventStream = typeof debug.eventStreamJson === 'string' ? debug.eventStreamJson.trim() : '';
  let timelineSession = typeof debug.timelineSessionJson === 'string' ? debug.timelineSessionJson.trim() : '';
  const uiGraph = typeof debug.uiGraphJson === 'string' ? debug.uiGraphJson.trim() : '';
  const layoutProbeSnippet = typeof debug.layoutProbeSnippet === 'string' ? debug.layoutProbeSnippet.trim() : '';
  const uiGraphSummary = debug.uiGraphSummary && typeof debug.uiGraphSummary === 'object'
    ? debug.uiGraphSummary
    : null;

  if (!eventStream && !timelineSession && !uiGraph && !layoutProbeSnippet) return null;

  const eventStreamObj = safeParseJson(eventStream);
  const timelineSessionObj = safeParseJson(timelineSession);
  const uiGraphObj = safeParseJson(uiGraph);
  let combinedJson = '';
  let mergedTimeline = null;

  try {
    const combined = {};
    if (timelineSessionObj || eventStreamObj){
      const baseTimeline = timelineSessionObj
        ? { ...timelineSessionObj }
        : {
            locale_tz: eventStreamObj?.locale_tz,
            exported_at: eventStreamObj?.exported_at,
            events: [],
          };
      const primaryEvents = Array.isArray(timelineSessionObj?.events) ? timelineSessionObj.events : [];
      const secondaryEvents = Array.isArray(eventStreamObj?.events) ? eventStreamObj.events : [];
      baseTimeline.events = mergeTimelineEvents(primaryEvents, secondaryEvents);
      combined.timeline_session = baseTimeline;
      mergedTimeline = baseTimeline;
    }
    if (eventStreamObj) combined.event_stream = eventStreamObj;
    if (uiGraphObj) combined.ui_graph = uiGraphObj;
    if (layoutProbeSnippet) combined.layout_probe_snippet = layoutProbeSnippet;
    if (Object.keys(combined).length){
      combinedJson = JSON.stringify(combined, null, 2);
    }
  } catch (error){
    console.error('Failed to build combined developer debug JSON', error);
  }

  if (combinedJson && mergedTimeline){
    try {
      timelineSession = JSON.stringify(mergedTimeline, null, 2);
    } catch (error){
      console.error('Failed to serialize merged timeline session', error);
    }
  }

  return {
    eventStream,
    timelineSession,
    uiGraph,
    layoutProbeSnippet,
    uiGraphSummary,
    combinedJson,
  };
}

function renderDeveloperDebug(debugInfo){
  if (!debugInfo) return;
  const section = document.createElement('section');
  section.className = 'day debug';

  const header = document.createElement('header');
  const titleWrapper = document.createElement('div');
  const title = document.createElement('h2');
  title.textContent = 'Developer Debug Export';
  titleWrapper.appendChild(title);
  const subtitle = document.createElement('p');
  subtitle.className = 'debug-subtitle';
  subtitle.textContent = 'Raw timeline, UI graph, and helper snippets available while Developer Debug Mode is enabled.';
  titleWrapper.appendChild(subtitle);
  header.appendChild(titleWrapper);
  if (debugInfo.combinedJson && canUseClipboard){
    const actions = document.createElement('div');
    actions.className = 'debug-block-controls';
    const copyAllBtn = document.createElement('button');
    copyAllBtn.type = 'button';
    copyAllBtn.className = 'ghost debug-copy';
    copyAllBtn.textContent = 'Copy all JSON';
    copyAllBtn.addEventListener('click', async () => {
      await copyTextToClipboard(debugInfo.combinedJson, copyAllBtn);
    });
    actions.appendChild(copyAllBtn);
    header.appendChild(actions);
  }
  section.appendChild(header);

  const content = document.createElement('div');
  content.className = 'debug-content';

  if (debugInfo.uiGraphSummary){
    const summaryContent = createGraphSummary(debugInfo.uiGraphSummary);
    if (summaryContent){
      content.appendChild(createDebugBlock({
        title: 'UI Graph Summary',
        subtitle: 'Inferred layout nodes from recent click events.',
        content: summaryContent,
      }));
    }
  }

  if (debugInfo.timelineSession){
    content.appendChild(createDebugBlock({
      title: 'Timeline Session (JSON)',
      subtitle: 'Normalized timeline events ready for LLM ingestion.',
      copyText: debugInfo.timelineSession,
      copyLabel: 'Copy JSON',
      content: createPreBlock(debugInfo.timelineSession),
    }));
  }

  if (debugInfo.uiGraph){
    content.appendChild(createDebugBlock({
      title: 'UI Graph (JSON)',
      subtitle: 'Semantic UI map reconstructed from click selectors.',
      copyText: debugInfo.uiGraph,
      copyLabel: 'Copy JSON',
      content: createPreBlock(debugInfo.uiGraph),
    }));
  }

  if (debugInfo.eventStream){
    content.appendChild(createDebugBlock({
      title: 'Event Stream (JSON)',
      subtitle: 'Full developer debug event stream with clicks, network, and console data.',
      copyText: debugInfo.eventStream,
      copyLabel: 'Copy JSON',
      content: createPreBlock(debugInfo.eventStream),
    }));
  }

  if (debugInfo.layoutProbeSnippet){
    content.appendChild(createDebugBlock({
      title: 'Layout Probe Snippet',
      subtitle: 'Optional helper—run in the page console to capture computed styles for a selector.',
      copyText: debugInfo.layoutProbeSnippet,
      copyLabel: 'Copy snippet',
      content: createPreBlock(debugInfo.layoutProbeSnippet),
    }));
  }

  section.appendChild(content);
  sectionsEl.appendChild(section);
}

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

function renderDays(days, debug){
  clearView();
  currentDays = [];
  updateExportState();
  const debugInfo = prepareDeveloperDebug(debug);
  const hasDebug = !!debugInfo;
  const hasDays = Array.isArray(days) && days.length > 0;

  if (!hasDays && !hasDebug){
    showEmpty(true);
    return;
  }

  showEmpty(false);
  linksEl.hidden = !hasDays;

  if (hasDays){
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

  if (hasDebug){
    renderDeveloperDebug(debugInfo);
  }
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

  const historyLines = Array.isArray(day.historyLines)
    ? day.historyLines
    : (Array.isArray(day.lines) ? day.lines : []);
  const timelineLines = Array.isArray(day.timelineLines)
    ? day.timelineLines
    : [];
  const historyText = historyLines.join('\n');
  const timelineText = timelineLines.join('\n');
  const hasHistory = historyLines.length > 0;
  const hasTimeline = timelineLines.length > 0;

  function buildDayText(role){
    const prefix = role ? `[Role: ${role}]\n\n` : '';
    const segments = [];
    if (hasHistory) segments.push(historyText);
    if (hasTimeline) segments.push(`Developer Debug Timeline:\n${timelineText}`);
    const combined = segments.join('\n\n');
    return `${prefix}${combined}`.trim();
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

  if (hasHistory){
    const historyPre = document.createElement('pre');
    historyPre.textContent = historyText;
    article.appendChild(historyPre);
  }

  if (hasTimeline){
    const timelineWrapper = document.createElement('div');
    timelineWrapper.className = 'debug-timeline';
    const heading = document.createElement('h3');
    heading.textContent = 'Developer Debug Timeline';
    timelineWrapper.appendChild(heading);
    const timelinePre = document.createElement('pre');
    timelinePre.textContent = timelineText;
    timelineWrapper.appendChild(timelinePre);
    article.appendChild(timelineWrapper);
  }

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
    renderDays(resp.days || [], resp.debug);
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
