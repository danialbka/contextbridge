
/* global chrome */
const EVENTS_KEY = 'cca_events_v1';
const SETTINGS_KEY = 'cca_settings_v1';
const SESSION_KEY = 'cca_session_v1';

const HISTORY_DB_NAME = 'cca_history_days_v1';
const HISTORY_DB_VERSION = 1;
const HISTORY_STORE = 'days';

let historyDbPromise;

const DEFAULT_SETTINGS = {
  captureInputs: true,
  captureSelections: true,
  maxEvents: 1000,
  maxSnippetLen: 500,
  minSnippetLen: 15,
  allowList: [],
  blockList: ["accounts.google.com","paypal.com","bank","chat.openai.com/auth"],
  includeHistoryWindowMinutes: 45,
  timeFormat: 'local',
};

function clampInt(value, { min = 0, max = Number.MAX_SAFE_INTEGER, fallback } = {}){
  const num = Number(value);
  if (!Number.isFinite(num)) return fallback;
  const intVal = Math.trunc(num);
  return Math.min(max, Math.max(min, intVal));
}

function normalizeSettings(raw){
  const merged = { ...DEFAULT_SETTINGS, ...(raw || {}) };
  return {
    ...merged,
    captureInputs: !!merged.captureInputs,
    captureSelections: !!merged.captureSelections,
    maxEvents: clampInt(merged.maxEvents, { min: 1, max: 50000, fallback: DEFAULT_SETTINGS.maxEvents }),
    maxSnippetLen: clampInt(merged.maxSnippetLen, { min: 1, max: 4000, fallback: DEFAULT_SETTINGS.maxSnippetLen }),
    minSnippetLen: clampInt(merged.minSnippetLen, { min: 0, max: 2000, fallback: DEFAULT_SETTINGS.minSnippetLen }),
    allowList: Array.isArray(merged.allowList) ? merged.allowList : [],
    blockList: Array.isArray(merged.blockList) ? merged.blockList : DEFAULT_SETTINGS.blockList,
    includeHistoryWindowMinutes: clampInt(merged.includeHistoryWindowMinutes, { min: 0, max: 7 * 24 * 60, fallback: DEFAULT_SETTINGS.includeHistoryWindowMinutes }),
    timeFormat: merged.timeFormat === 'iso' ? 'iso' : 'local',
  };
}

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
      .map((day) => {
        const sortValue = Number(day?.sortValue);
        if (!Array.isArray(day?.lines) || day.lines.length === 0) return null;
        if (!Number.isFinite(sortValue)) return null;
        return {
          id: `day-${sortValue}`,
          label: fmtDay(sortValue, settings.timeFormat),
          sortValue,
          lines: day.lines,
        };
      })
      .filter(Boolean)
      .sort((a,b)=>a.sortValue - b.sortValue);
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
  return normalizeSettings(s);
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
  const windowMs = settings.includeHistoryWindowMinutes*60*1000;
  const sinceTs = Date.now() - windowMs;
  const since = new Date(sinceTs);
  const maxResults = Math.max(settings.maxEvents || 0, 200);

  const [hist, events] = await Promise.all([
    chrome.history.search({ text: '', startTime: since.getTime(), maxResults }),
    getEvents()
  ]);

  const histItems = hist.filter((h) => Number.isFinite(h.lastVisitTime));
  histItems.sort((a,b)=>a.lastVisitTime-b.lastVisitTime);

  const entryList = [];
  const buckets = new Map();

  function ensureBucket(ts){
    const bucket = dayBucket(ts);
    if (!buckets.has(bucket.dayKey)){
      buckets.set(bucket.dayKey, { ...bucket, entries: [] });
    }
    return buckets.get(bucket.dayKey);
  }

  function pushEntry(ts, line){
    if (!line) return;
    entryList.push({ ts, line });
    ensureBucket(ts).entries.push({ ts, line });
  }

  histItems.forEach((h) => {
    if (!domainAllowed(h.url||'', settings)) return;
    const t = fmtTime(h.lastVisitTime, settings.timeFormat);
    const srch = parseSearch(h.url||'');
    const extra = srch ? ` [search:${srch.engine}] → "${srch.query}"` : '';
    const line = `- [${t}] ${h.title||'(untitled)'} — ${h.url}${extra}`;
    pushEntry(h.lastVisitTime, line);
  });

  if (settings.captureInputs){
    const inputEvents = events.filter((ev) => ev?.kind === 'input' && Number.isFinite(ev.ts) && ev.ts >= sinceTs);
    inputEvents.sort((a,b)=>a.ts-b.ts);
    inputEvents.forEach((ev) => {
      if (!domainAllowed(ev.url || '', settings)) return;
      const t = fmtTime(ev.ts, settings.timeFormat);
      const label = ev.label ? ` (${ev.label})` : '';
      const title = `Input${label}`;
      const url = ev.url || '';
      const rawValue = ev.value || '';
      const snippet = rawValue.replace(/\s+/g, ' ').trim().slice(0, 180);
      if (!snippet) return;
      const line = `- [${t}] ${title} — ${url} [input] ${snippet}`.trim();
      pushEntry(ev.ts, line);
    });
  }

  entryList.sort((a,b)=>a.ts-b.ts);
  const entries = entryList.map((item) => item.line);

  const days = Array.from(buckets.values())
    .map((bucket) => ({
      ...bucket,
      lines: bucket.entries
        .slice()
        .sort((a,b)=>a.ts-b.ts)
        .map((item) => item.line),
    }))
    .sort((a,b)=>a.sortValue - b.sortValue)
    .map((bucket) => ({
      dayKey: bucket.dayKey,
      sortValue: bucket.sortValue,
      lines: bucket.lines,
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
      await pushEvent({ ...ev, ts: nowTs(), tabId: sender.tab?.id ?? -1 });
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
