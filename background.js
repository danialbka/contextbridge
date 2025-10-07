
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
  const blocked = settings.blockList.some((b) => host.includes(b) || url.includes(b));
  if (blocked) return false;
  if (settings.allowList.length === 0) return true;
  return settings.allowList.some((a) => host.includes(a));
}

function isAbsoluteUrl(value){
  if (typeof value !== 'string' || !value) return false;
  try {
    const parsed = new URL(value);
    return !!parsed.protocol && !!parsed.hostname;
  } catch {
    return false;
  }
}

function resolveUrl(candidate, base){
  if (typeof candidate !== 'string' || !candidate) return '';
  if (isAbsoluteUrl(candidate)) return candidate;
  try {
    if (base && isAbsoluteUrl(base)) {
      return new URL(candidate, base).href;
    }
  } catch {}
  return '';
}

function primaryEventUrl(ev = {}, sender = {}){
  const base = sender?.tab?.url;
  const options = [ev.url, ev.pageUrl, ev.origin];
  for (const value of options){
    const resolved = resolveUrl(value, base);
    if (resolved) return resolved;
  }
  if (base && isAbsoluteUrl(base)) return base;
  return '';
}

function formatInteractionTimestamp(ts, mode = 'local'){
  const value = Number(ts);
  if (!Number.isFinite(value)) return '—';
  const d = new Date(value);
  if (mode === 'iso') return d.toISOString();
  const opts = { hour: '2-digit', minute: '2-digit', second: '2-digit', hour12: false };
  const base = d.toLocaleTimeString(undefined, opts);
  const ms = String(d.getMilliseconds()).padStart(3, '0');
  return `${base}.${ms}`;
}

function formatDurationMs(ms){
  const value = Number(ms);
  if (!Number.isFinite(value) || value <= 0) return '';
  return `${Math.round(value)} ms`;
}

function formatBytesValue(bytes){
  const value = Number(bytes);
  if (!Number.isFinite(value) || value <= 0) return '';
  if (value >= 1024){
    const kb = value / 1024;
    const rounded = kb >= 10 ? Math.round(kb) : Math.round(kb * 10) / 10;
    return `${rounded} KB`;
  }
  return `${Math.round(value)} B`;
}

function formatInteractionDetail(ev){
  if (!ev || typeof ev.type !== 'string') return '';
  if (ev.type === 'net'){
    const kind = (ev.kind || 'net').toUpperCase();
    const method = ev.method ? `${String(ev.method).toUpperCase()} ` : '';
    const target = ev.url || ev.fullUrl || ev.path || '';
    let line = `${kind} ${method}${target}`.trim();
    if (typeof ev.status !== 'undefined') line += ` ${ev.status}`;
    const dur = formatDurationMs(ev.dur_ms ?? ev.duration_ms ?? ev.duration);
    if (dur) line += ` in ${dur}`;
    const size = formatBytesValue(ev.resp_bytes ?? ev.response_bytes ?? ev.bytes);
    if (size) line += `, ${size}`;
    if (ev.redacted) line += ' (redacted)';
    return line;
  }
  if (ev.type === 'console' || ev.type === 'error'){
    const level = ev.type === 'error' ? 'ERROR' : `Console.${(ev.level || 'log').toLowerCase()}`;
    const msg = ev.msg || ev.message || '';
    let line = `${level}: ${msg}`.trim();
    let location = '';
    if (ev.stack){
      const firstLine = String(ev.stack).split('\n')[0];
      if (firstLine) location = firstLine;
    } else if (ev.src){
      location = ev.src;
      if (ev.line) location += `:${ev.line}`;
      if (ev.col) location += `:${ev.col}`;
    }
    if (location) line += ` (${location})`;
    return line;
  }
  if (ev.type === 'route'){
    const from = ev.from || '—';
    const to = ev.to || '—';
    const mode = ev.mode ? ` (${ev.mode})` : '';
    return `Route ${from} ➜ ${to}${mode}`.trim();
  }
  if (ev.type === 'dom'){
    const pieces = [];
    if (Number.isFinite(ev.adds)) pieces.push(`adds ${ev.adds}`);
    if (Number.isFinite(ev.removes)) pieces.push(`removes ${ev.removes}`);
    return pieces.length ? `DOM ${pieces.join(', ')}` : 'DOM change';
  }
  if (ev.type === 'perf'){
    const metric = ev.metric || 'perf';
    const dur = formatDurationMs(ev.value_ms ?? ev.value ?? ev.duration_ms);
    return dur ? `Perf ${metric}: ${dur}` : `Perf ${metric}`;
  }
  if (ev.type === 'click'){
    return '';
  }
  return `${String(ev.type).toUpperCase()} event`;
}

function buildInteractionTimeline(events, settings){
  const debugEvents = (events || []).filter((ev) => ev && typeof ev.type === 'string');
  if (!debugEvents.length) return [];

  const groups = new Map();
  debugEvents.forEach((ev, idx) => {
    let key = null;
    if (ev.type === 'click' && ev.id) key = ev.id;
    else if (ev.click_id) key = ev.click_id;
    else key = `orphan-${idx}`;
    if (!groups.has(key)) groups.set(key, []);
    groups.get(key).push(ev);
  });

  const sortedGroups = Array.from(groups.values()).sort((a, b) => {
    const aTs = Math.min(...a.map((ev) => Number(ev.ts) || Number.POSITIVE_INFINITY));
    const bTs = Math.min(...b.map((ev) => Number(ev.ts) || Number.POSITIVE_INFINITY));
    return aTs - bTs;
  });

  const lines = [];
  sortedGroups.forEach((group) => {
    const ordered = group.slice().sort((a, b) => (Number(a.ts) || 0) - (Number(b.ts) || 0));
    const primary = ordered.find((ev) => ev.type === 'click') || ordered[0];
    if (!primary) return;
    const tsLabel = formatInteractionTimestamp(primary.ts, settings.timeFormat);
    const headerParts = [];
    if (primary.type === 'click'){
      headerParts.push('**CLICK**');
      if (primary.selector) headerParts.push(`\`${primary.selector}\``);
      const text = primary.text || primary.title;
      if (text) headerParts.push(`“${text}”`);
      const location = primary.url || primary.pageUrl;
      if (location) headerParts.push(`@ \`${location}\``);
    } else {
      const label = `**${String(primary.type).toUpperCase()}**`;
      const detail = formatInteractionDetail(primary);
      headerParts.push(detail ? `${label} ${detail}` : label);
    }
    lines.push(`* [${tsLabel}] ${headerParts.join(' ')}`.trim());
    ordered.forEach((ev) => {
      if (ev === primary) return;
      const detail = formatInteractionDetail(ev);
      if (detail) lines.push(`  ↳ ${detail}`);
    });
  });

  return lines;
}

function sanitizeEventForJson(ev){
  const clean = {};
  if (!ev || typeof ev !== 'object') return clean;
  Object.entries(ev).forEach(([key, value]) => {
    if (typeof value === 'undefined' || typeof value === 'function') return;
    clean[key] = value;
  });
  return clean;
}

function buildEventStreamJson(events){
  const debugEvents = (events || []).filter((ev) => ev && typeof ev.type === 'string');
  if (!debugEvents.length) return '';
  const tz = Intl.DateTimeFormat().resolvedOptions().timeZone || 'UTC';
  const payload = {
    event_version: '1.0',
    locale_tz: tz,
    exported_at: new Date().toISOString(),
    events: debugEvents.map((ev) => sanitizeEventForJson(ev)),
  };
  return JSON.stringify(payload, null, 2);
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
      const ev = msg.payload || {};
      if (ev.debugOnly && !settings.developerDebugMode) {
        return sendResponse({ ok: true });
      }
      const resolvedUrl = primaryEventUrl(ev, sender);
      if (!domainAllowed(resolvedUrl, settings)) return sendResponse({ ok: true });
      const stored = { ...ev, ts: nowTs(), tabId: sender.tab?.id ?? -1 };
      if (!stored.pageUrl && resolvedUrl) stored.pageUrl = resolvedUrl;
      await pushEvent(stored);
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
      const respPayload = { ok: true, days: history.days };
      if (settings.developerDebugMode){
        const events = await getEvents();
        events.sort((a,b)=>a.ts-b.ts);
        const timelineLines = buildInteractionTimeline(events, settings);
        const eventStreamJson = buildEventStreamJson(events);
        if (timelineLines.length || eventStreamJson){
          respPayload.debug = {
            timelineLines,
            eventStreamJson,
          };
        }
      }
      return sendResponse(respPayload);
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
  if (settings.developerDebugMode){
    const timelineLines = buildInteractionTimeline(events, settings);
    if (timelineLines.length){
      lines.push('');
      lines.push('## Interaction Timeline (Clicks • Network • Console • Route)');
      timelineLines.forEach((line) => lines.push(line));
    }
    const eventStreamJson = buildEventStreamJson(events);
    if (eventStreamJson){
      lines.push('');
      lines.push('## Event Stream (JSON)');
      lines.push('```json');
      lines.push(eventStreamJson);
      lines.push('```');
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
