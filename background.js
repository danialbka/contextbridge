
/* global chrome */
const EVENTS_KEY = 'cca_events_v1';
const SETTINGS_KEY = 'cca_settings_v1';
const SESSION_KEY = 'cca_session_v1';

const HISTORY_DB_NAME = 'cca_history_days_v1';
const HISTORY_DB_VERSION = 1;
const HISTORY_STORE = 'days';

let historyDbPromise;

const DEFAULT_SETTINGS = {
  captureInputs: false,
  captureSelections: true,
  maxEvents: 1000,
  maxSnippetLen: 500,
  minSnippetLen: 15,
  allowList: [],
  blockList: ["accounts.google.com","paypal.com","bank","chat.openai.com/auth"],
  includeHistoryWindowMinutes: 45,
  timeFormat: 'local',
  developerDebugMode: false,
};

function getHistoryDb(){
  if (!historyDbPromise){
    historyDbPromise = new Promise((resolve, reject) => {
      const req = indexedDB.open(HISTORY_DB_NAME, HISTORY_DB_VERSION);
      req.onerror = () => reject(req.error);
      req.onupgradeneeded = () => {
        const db = req.result;
        if (!db.objectStoreNames.contains(HISTORY_STORE)){
          const store = db.createObjectStore(HISTORY_STORE, { keyPath: 'dayKey' });
          store.createIndex('sort', 'sortValue');
        }
      };
      req.onsuccess = () => resolve(req.result);
    });
  }
  return historyDbPromise;
}

function idbRequest(req){
  return new Promise((resolve, reject) => {
    req.onsuccess = () => resolve(req.result);
    req.onerror = () => reject(req.error);
  });
}

function idbTxDone(tx){
  return new Promise((resolve, reject) => {
    tx.oncomplete = () => resolve();
    tx.onerror = () => reject(tx.error);
    tx.onabort = () => reject(tx.error);
  });
}

function mergeDayLines(existingLines = [], newLines = []){
  const seen = new Set(existingLines);
  const merged = existingLines.slice();
  newLines.forEach((line) => {
    if (!seen.has(line)){
      merged.push(line);
      seen.add(line);
    }
  });
  return merged;
}

async function persistHistoryDays(days, settings){
  if (!days.length) return;
  try {
    const db = await getHistoryDb();
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    const store = tx.objectStore(HISTORY_STORE);
    for (const day of days){
      const existing = await idbRequest(store.get(day.dayKey));
      const existingLines = Array.isArray(existing?.lines) ? existing.lines : [];
      const mergedLines = mergeDayLines(existingLines, day.lines);
      const record = {
        dayKey: day.dayKey,
        sortValue: day.sortValue,
        lines: mergedLines,
        updatedAt: nowTs(),
      };
      await idbRequest(store.put(record));
    }
    await idbTxDone(tx);
    await trimStoredHistory(settings.maxEvents);
  } catch (e){
    console.error('Persist history days failed', e);
  }
}

async function trimStoredHistory(maxEvents){
  try {
    if (!Number.isFinite(maxEvents) || maxEvents <= 0) return;
    const db = await getHistoryDb();
    const days = await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE, 'readonly');
      const store = tx.objectStore(HISTORY_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    let total = days.reduce((sum, d) => sum + (d.lines?.length || 0), 0);
    if (total <= maxEvents) return;
    days.sort((a,b)=>a.sortValue - b.sortValue);
    const tx = db.transaction(HISTORY_STORE, 'readwrite');
    const store = tx.objectStore(HISTORY_STORE);
    for (const day of days){
      if (total <= maxEvents) break;
      const lines = Array.isArray(day.lines) ? day.lines : [];
      while (lines.length && total > maxEvents){
        lines.shift();
        total--;
      }
      if (!lines.length){
        await idbRequest(store.delete(day.dayKey));
      } else {
        await idbRequest(store.put({ ...day, lines }));
      }
    }
    await idbTxDone(tx);
  } catch (e){
    console.error('Trim stored history failed', e);
  }
}

async function loadStoredHistoryDays(settings){
  try {
    const db = await getHistoryDb();
    const days = await new Promise((resolve, reject) => {
      const tx = db.transaction(HISTORY_STORE, 'readonly');
      const store = tx.objectStore(HISTORY_STORE);
      const req = store.getAll();
      req.onsuccess = () => resolve(req.result || []);
      req.onerror = () => reject(req.error);
    });
    return days
      .filter((d) => Array.isArray(d.lines) && d.lines.length)
      .sort((a,b)=>a.sortValue - b.sortValue)
      .map((day) => ({
        id: `day-${day.sortValue}`,
        label: fmtDay(day.sortValue, settings.timeFormat),
        sortValue: day.sortValue,
        lines: day.lines.slice(),
        text: day.lines.join('\n'),
      }));
  } catch (e){
    console.error('Load stored history days failed', e);
    return [];
  }
}

function nowTs(){ return Date.now(); }
function fmtTime(ts, mode='local'){
  const d = new Date(ts);
  return mode === 'iso' ? d.toISOString() : d.toLocaleString();
}
function fmtDay(ts, mode='local'){
  const d = new Date(ts);
  if (mode === 'iso') return d.toISOString().slice(0, 10);
  return d.toLocaleDateString(undefined, { weekday: 'short', year: 'numeric', month: 'short', day: 'numeric' });
}

async function getSettings(){
  const { [SETTINGS_KEY]: s } = await chrome.storage.sync.get(SETTINGS_KEY);
  return { ...DEFAULT_SETTINGS, ...(s||{}) };
}
async function setSettings(newS){ await chrome.storage.sync.set({ [SETTINGS_KEY]: newS }); }
async function getEvents(){
  const obj = await chrome.storage.local.get(EVENTS_KEY);
  return obj[EVENTS_KEY] || [];
}
async function pushEvent(ev){
  const settings = await getSettings();
  const events = await getEvents();
  events.push(ev);
  const overshoot = events.length - settings.maxEvents;
  if (overshoot > 0) events.splice(0, overshoot);
  await chrome.storage.local.set({ [EVENTS_KEY]: events });
}
async function clearEvents(){ await chrome.storage.local.set({ [EVENTS_KEY]: [] }); }
async function initSession(){
  const sess = { startedAt: nowTs(), id: crypto.randomUUID() };
  await chrome.storage.local.set({ [SESSION_KEY]: sess, [EVENTS_KEY]: [] });
  return sess;
}
async function getSession(){
  const { [SESSION_KEY]: s } = await chrome.storage.local.get(SESSION_KEY);
  return s || await initSession();
}
function urlDomain(u){ try { return new URL(u).hostname; } catch { return ''; } }
function domainAllowed(url, settings){
  const host = urlDomain(url);
  if (!host) return false;
  const blocked = settings.blockList.some(b => host.includes(b) || url.includes(b));
  if (blocked) return false;
  if (settings.allowList.length === 0) return true;
  return settings.allowList.some(a => host.includes(a));
}
function parseSearch(u){
  try {
    const url = new URL(u);
    const host = url.hostname;
    const params = url.searchParams;
    if (host.includes('google.') && params.get('q')) return { engine: 'google', query: params.get('q') };
    if (host.includes('bing.com') && params.get('q')) return { engine: 'bing', query: params.get('q') };
    if (host.includes('duckduckgo.com') && params.get('q')) return { engine: 'duckduckgo', query: params.get('q') };
    if (host.includes('youtube.com') && params.get('search_query')) return { engine: 'youtube', query: params.get('search_query') };
    if (host.includes('youtube.com') && url.pathname.startsWith('/results') && params.get('search_query')) return { engine: 'youtube', query: params.get('search_query') };
    return null;
  } catch { return null; }
}

function dayBucket(ts){
  const d = new Date(ts);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const sortValue = start.getTime();
  return { dayKey: String(sortValue), sortValue };
}

async function collectRecentHistory(settings){
  const since = new Date(Date.now() - settings.includeHistoryWindowMinutes*60*1000);
  const maxResults = Math.max(settings.maxEvents || 0, 200);
  const hist = await chrome.history.search({ text: '', startTime: since.getTime(), maxResults });
  hist.sort((a,b)=>a.lastVisitTime-b.lastVisitTime);

  const entries = [];
  const buckets = new Map();

  hist.forEach((h) => {
    if (!domainAllowed(h.url||'', settings)) return;
    const t = fmtTime(h.lastVisitTime, settings.timeFormat);
    const srch = parseSearch(h.url||'');
    const extra = srch ? ` [search:${srch.engine}] → "${srch.query}"` : '';
    const line = `- [${t}] ${h.title||'(untitled)'} — ${h.url}${extra}`;
    entries.push(line);

    const bucket = dayBucket(h.lastVisitTime);
    if (!buckets.has(bucket.dayKey)){
      buckets.set(bucket.dayKey, { ...bucket, lines: [] });
    }
    buckets.get(bucket.dayKey).lines.push(line);
  });

  const days = Array.from(buckets.values())
    .sort((a,b)=>a.sortValue - b.sortValue)
    .map((bucket) => ({
      dayKey: bucket.dayKey,
      sortValue: bucket.sortValue,
      lines: bucket.lines.slice(),
    }));

  await persistHistoryDays(days, settings);
  const storedDays = await loadStoredHistoryDays(settings);

  return { entries, days: storedDays };
}

async function clearRecentHistory(settings){
  const endTime = Date.now();
  const startTime = endTime - settings.includeHistoryWindowMinutes*60*1000;
  await chrome.history.deleteRange({ startTime, endTime });
}

chrome.runtime.onMessage.addListener((msg, sender, sendResponse) => {
  (async () => {
    const settings = await getSettings();
    if (msg?.type === 'EVENT') {
      const ev = msg.payload;
      if (!domainAllowed(ev.url || '', settings)) return sendResponse({ ok: true });
      const ts = Number.isFinite(ev?.ts) ? ev.ts : nowTs();
      await pushEvent({ ...ev, ts, tabId: sender.tab?.id ?? -1 });
      return sendResponse({ ok: true });
    }

    if (msg?.type === 'COMPOSE_REPORT') {
      const text = await composeReport();
      return sendResponse({ ok: true, text });
    }

    if (msg?.type === 'CLEAR_EVENTS') {
      await clearEvents();
      return sendResponse({ ok: true });
    }

    if (msg?.type === 'GET_COUNTS') {
      const events = await getEvents();
      const sess = await getSession();
      return sendResponse({ ok: true, count: events.length, startedAt: sess.startedAt });
    }

    if (msg?.type === 'SAVE_SETTINGS') {
      await setSettings(msg.settings);
      return sendResponse({ ok: true });
    }

    if (msg?.type === 'GET_SETTINGS') {
      const s = await getSettings();
      return sendResponse({ ok: true, settings: s });
    }

    if (msg?.type === 'GET_HISTORY_BY_DAY') {
      const history = await collectRecentHistory(settings);
      return sendResponse({ ok: true, days: history.days });
    }

    if (msg?.type === 'CLEAR_HISTORY_WINDOW') {
      await clearRecentHistory(settings);
      return sendResponse({ ok: true });
    }

    if (msg?.type === 'OPEN_AND_SEND') {
      // msg.text must be provided by popup
      try {
        await openAndSendToChatGPT(msg.text || '');
        return sendResponse({ ok: true });
      } catch (e) {
        console.error('OPEN_AND_SEND error', e);
        return sendResponse({ ok: false, error: String(e) });
      }
    }
  })();
  return true;
});

function isDeveloperEvent(ev){
  return !!ev && typeof ev.type === 'string';
}

function getDeveloperEvents(events){
  return events.filter(isDeveloperEvent);
}

function coerceTs(value){
  const num = Number(value);
  return Number.isFinite(num) ? num : NaN;
}

function fmtDebugTime(ts, settings){
  const num = coerceTs(ts);
  if (!Number.isFinite(num)) return fmtTime(Date.now(), settings.timeFormat);
  return fmtTime(num, settings.timeFormat);
}

function truncate(str = '', max = 80){
  if (str.length <= max) return str;
  return `${str.slice(0, max - 1)}…`;
}

function formatBytes(bytes){
  if (!Number.isFinite(bytes) || bytes <= 0) return '';
  if (bytes < 1024) return `${bytes} B`;
  if (bytes < 1024 * 1024) return `${(bytes / 1024).toFixed(1)} KB`;
  return `${(bytes / (1024 * 1024)).toFixed(1)} MB`;
}

function formatNetworkEvent(ev){
  const kind = (ev.kind || '').toUpperCase();
  const label = kind === 'FETCH' ? 'fetch' : kind === 'XHR' ? 'XHR' : kind || 'NET';
  const method = (ev.method || '').toUpperCase();
  const url = ev.url || '';
  const status = typeof ev.status === 'number' || typeof ev.status === 'string'
    ? ` **${ev.status}**`
    : '';
  const dur = Number.isFinite(ev.dur_ms) ? ` in **${Math.round(ev.dur_ms)} ms**` : '';
  const size = formatBytes(ev.resp_bytes);
  const sizePart = size ? `, ${size}` : '';
  const redacted = ev.redacted ? ' (redacted)' : '';
  const methodPart = method ? `${method} ` : '';
  const urlDisplay = url ? truncate(url, 120) : '';
  return `↳ ${label} \`${methodPart}${urlDisplay}\`${status}${dur}${sizePart}${redacted}`;
}

function formatConsoleEvent(ev){
  const level = (ev.level || '').toLowerCase();
  const msg = ev.msg || ev.message || '';
  const stack = ev.stack ? ` (${truncate(ev.stack, 80)})` : '';
  const base = level ? `Console.${level}` : 'Console';
  return `↳ ${base}: “${truncate(msg, 160)}”${stack}`;
}

function formatErrorEvent(ev){
  const msg = ev.msg || ev.message || '';
  const src = ev.src ? ` at ${ev.src}${Number.isFinite(ev.line) ? `:${ev.line}` : ''}` : '';
  return `↳ **ERROR** ${truncate(msg, 160)}${src}`;
}

function formatRouteEvent(ev){
  const from = ev.from ? truncate(ev.from, 120) : '';
  const to = ev.to ? truncate(ev.to, 120) : '';
  const arrow = from && to ? `${from} ➜ ${to}` : to ? `➜ ${to}` : from ? `from ${from}` : 'route change';
  const mode = ev.mode ? ` • ${ev.mode}` : '';
  return `↳ Route ${arrow}${mode}`;
}

function formatDomEvent(ev){
  const adds = Number.isFinite(ev.adds) ? `+${ev.adds}` : null;
  const removes = Number.isFinite(ev.removes) ? `-${ev.removes}` : null;
  const parts = [adds, removes].filter(Boolean).join(' / ');
  return `↳ DOM: ${parts || 'mutation'}`;
}

function formatPerfEvent(ev){
  const metric = ev.metric || 'perf';
  const value = Number.isFinite(ev.value_ms) ? `${ev.value_ms} ms` : (Number.isFinite(ev.value) ? `${ev.value}` : '');
  return `↳ Perf ${metric}: ${value}`;
}

function formatMiscEvent(ev){
  const payload = { ...ev };
  delete payload.type;
  delete payload.ts;
  const data = Object.keys(payload).length ? ` ${truncate(JSON.stringify(payload), 160)}` : '';
  return `↳ ${ev.type}${data}`;
}

function describeEvent(ev){
  if (!ev || ev.type === 'click') return null;
  switch (ev.type){
    case 'net': return formatNetworkEvent(ev);
    case 'console': return formatConsoleEvent(ev);
    case 'error': return formatErrorEvent(ev);
    case 'route': return formatRouteEvent(ev);
    case 'dom': return formatDomEvent(ev);
    case 'perf': return formatPerfEvent(ev);
    default: return formatMiscEvent(ev);
  }
}

function formatClickHeader(click, fallbackTs, settings){
  const ts = fmtDebugTime(click?.ts ?? fallbackTs, settings);
  if (!click){
    return `* [${ts}] **EVENT** (no click context)`;
  }
  const selector = click.selector ? ` \`${truncate(click.selector, 80)}\`` : '';
  const text = click.text ? ` “${truncate(click.text, 80)}”` : '';
  const url = click.url ? ` @ ${truncate(click.url, 140)}` : '';
  return `* [${ts}] **CLICK**${selector}${text}${url}`;
}

function getEventTimestamp(ev){
  return coerceTs(ev?.ts);
}

function buildInteractionTimeline(events, settings){
  const debugEvents = getDeveloperEvents(events);
  if (!debugEvents.length) return ['*(No developer debug events captured)*'];

  const groups = new Map();
  let orphanCounter = 0;
  debugEvents.forEach((ev) => {
    const ts = getEventTimestamp(ev);
    const key = ev.type === 'click' && ev.id
      ? `click:${ev.id}`
      : ev.click_id
        ? `click:${ev.click_id}`
        : `orphan:${ev.type}:${Number.isFinite(ts) ? ts : ++orphanCounter}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  });

  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    const ta = a.reduce((min, ev) => {
      const ts = getEventTimestamp(ev);
      return Math.min(min, Number.isFinite(ts) ? ts : Infinity);
    }, Infinity);
    const tb = b.reduce((min, ev) => {
      const ts = getEventTimestamp(ev);
      return Math.min(min, Number.isFinite(ts) ? ts : Infinity);
    }, Infinity);
    return ta - tb;
  });

  const lines = [];
  sortedGroups.forEach((group) => {
    group.sort((a, b) => {
      const ta = getEventTimestamp(a);
      const tb = getEventTimestamp(b);
      return (Number.isFinite(ta) ? ta : 0) - (Number.isFinite(tb) ? tb : 0);
    });
    const click = group.find((ev) => ev.type === 'click');
    const header = formatClickHeader(click, group[0]?.ts, settings);
    lines.push(header);
    group.forEach((ev) => {
      if (ev === click) return;
      const desc = describeEvent(ev);
      if (desc) lines.push(`  ${desc}`);
    });
  });
  return lines;
}

function sanitizeForJson(value){
  if (value === null || typeof value !== 'object') return value;
  if (Array.isArray(value)) return value.map((v) => sanitizeForJson(v));
  const out = {};
  Object.entries(value).forEach(([key, val]) => {
    if (typeof val === 'undefined') return;
    if (typeof val === 'number' && !Number.isFinite(val)) return;
    out[key] = sanitizeForJson(val);
  });
  return out;
}

function buildEventStream(events){
  const debugEvents = getDeveloperEvents(events);
  const tz = (() => {
    try {
      return Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
    } catch {
      return 'UTC';
    }
  })();
  return {
    event_version: '1.0',
    locale_tz: tz,
    events: debugEvents.map((ev) => sanitizeForJson(ev)),
  };
}

async function composeReport(){
  const [settings, events, sess] = await Promise.all([getSettings(), getEvents(), getSession()]);
  const history = await collectRecentHistory(settings);

  const tabMap = {};
  try {
    const tabs = await chrome.tabs.query({});
    tabs.forEach(t => { tabMap[t.id] = { title: t.title || '', url: t.url || '' }; });
  } catch {}

  events.sort((a,b)=>a.ts-b.ts);

  const lines = [];
  lines.push(`# Session Context (Context Copy Agent)`);
  lines.push(`Started: ${fmtTime(sess.startedAt, settings.timeFormat)}\nExported: ${fmtTime(Date.now(), settings.timeFormat)}`);
  lines.push('');
  lines.push('**Capture Settings**:');
  lines.push(`- Selections: ${settings.captureSelections ? 'ON' : 'OFF'}`);
  lines.push(`- Form Inputs: ${settings.captureInputs ? 'ON' : 'OFF'}`);
  if (settings.allowList.length) lines.push(`- Allow List: ${settings.allowList.join(', ')}`);
  if (settings.blockList.length) lines.push(`- Block List: ${settings.blockList.join(', ')}`);
  lines.push('');
  lines.push('## Recent History (from browser)');
  history.entries.forEach((line) => lines.push(line));
  if (history.days.length){
    lines.push('');
    lines.push('## Recent History by Day');
    history.days.forEach((day, idx) => {
      lines.push(`### ${day.label}`);
      day.lines.forEach((entry) => lines.push(entry));
      if (idx !== history.days.length - 1) lines.push('');
    });
  }
  lines.push('');
  lines.push('## Session Timeline (tabs, selections, inputs)');
  for (const ev of events){
    const t = fmtTime(ev.ts, settings.timeFormat);
    const tabInfo = tabMap[ev.tabId] || {};
    const base = ` [Tab ${ev.tabId}] ${ev.title || tabInfo.title || ''} — ${ev.url || tabInfo.url || ''}`;
    if (ev.kind === 'page-open') {
      const sr = parseSearch(ev.url||'');
      const extra = sr ? ` | search:${sr.engine} → "${sr.query}"` : '';
      lines.push(`- [${t}] PAGE OPEN:${extra}${base}`);
    } else if (ev.kind === 'selection' && settings.captureSelections) {
      const snippet = (ev.text||'').slice(0, settings.maxSnippetLen).replaceAll('\n',' ');
      if (snippet.length >= settings.minSnippetLen)
        lines.push(`- [${t}] SELECT:${base}\n    “${snippet}”`);
    } else if (ev.kind === 'input' && settings.captureInputs) {
      const label = ev.label ? ` (${ev.label})` : '';
      const v = (ev.value||'').slice(0, 400).replaceAll('\n',' ');
      lines.push(`- [${t}] INPUT${label}:${base}\n    -> ${v}`);
    }
  }
  if (settings.developerDebugMode){
    lines.push('');
    lines.push('## Interaction Timeline (Clicks • Network • Console • Route)');
    const timelineLines = buildInteractionTimeline(events, settings);
    timelineLines.forEach((line) => lines.push(line));
    lines.push('');
    lines.push('## Event Stream (JSON)');
    const stream = buildEventStream(events);
    const streamJson = JSON.stringify(stream, null, 2).split('\n');
    lines.push('```json');
    streamJson.forEach((line) => lines.push(line));
    lines.push('```');
  }
  lines.push('\n---\n');
  lines.push('*(Generated by Context Copy Agent — local only, no uploads)*');
  return lines.join('\n');
}

// Open ChatGPT and inject text into composer
async function openAndSendToChatGPT(text){
  const tab = await chrome.tabs.create({ url: 'https://chat.openai.com/' });
  const listener = async (tabId, info, tabObj) => {
    if (tabId === tab.id && info.status === 'complete') {
      chrome.tabs.onUpdated.removeListener(listener);
      try {
        await chrome.scripting.executeScript({
          target: { tabId },
          files: ['inject_chatgpt.js']
        });
        // Hand the text to the injector
        await chrome.tabs.sendMessage(tabId, { type: 'PASTE_TEXT', text });
      } catch (e) {
        console.warn('Injection failed; user can paste manually.', e);
      }
    }
  };
  chrome.tabs.onUpdated.addListener(listener);
}

chrome.runtime.onInstalled.addListener(async () => {
  const s = await getSettings();
  await setSettings({ ...DEFAULT_SETTINGS, ...s });
  await initSession();
});
