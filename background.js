
/* global chrome */
const EVENTS_KEY = 'cca_events_v1';
const SETTINGS_KEY = 'cca_settings_v1';
const SESSION_KEY = 'cca_session_v1';

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
};

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

function dayBucket(ts, mode='local'){
  const d = new Date(ts);
  const start = new Date(d.getFullYear(), d.getMonth(), d.getDate());
  const label = fmtDay(ts, mode);
  const sortValue = start.getTime();
  const key = mode === 'iso' ? label : String(sortValue);
  return { key, label, sortValue, anchorId: `day-${sortValue}` };
}

async function collectRecentHistory(settings){
  const since = new Date(Date.now() - settings.includeHistoryWindowMinutes*60*1000);
  const hist = await chrome.history.search({ text: '', startTime: since.getTime(), maxResults: 200 });
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

    const bucketKey = dayBucket(h.lastVisitTime, settings.timeFormat);
    if (!buckets.has(bucketKey.key)){
      buckets.set(bucketKey.key, { ...bucketKey, lines: [] });
    }
    buckets.get(bucketKey.key).lines.push(line);
  });

  const days = Array.from(buckets.values())
    .sort((a,b)=>a.sortValue - b.sortValue)
    .map((bucket) => ({
      key: bucket.key,
      label: bucket.label,
      anchorId: bucket.anchorId,
      sortValue: bucket.sortValue,
      lines: bucket.lines.slice(),
    }));

  return { entries, days };
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
      const days = history.days.map((day) => ({
        id: day.anchorId,
        label: day.label,
        sortValue: day.sortValue,
        lines: day.lines,
        text: day.lines.join('\n'),
      }));
      return sendResponse({ ok: true, days });
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
