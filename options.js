
/* global chrome */
const el = (id) => document.getElementById(id);

const DEFAULTS = {
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

function toList(text){ return text.split(/\n+/).map(s=>s.trim()).filter(Boolean); }
function fromList(arr){ return (arr||[]).join('\n'); }

function load(){
  chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, (r)=>{
    const s = r.settings || DEFAULTS;
    el('captureInputs').checked = !!s.captureInputs;
    el('captureSelections').checked = !!s.captureSelections;
    el('maxEvents').value = s.maxEvents;
    el('historyWindow').value = s.includeHistoryWindowMinutes;
    el('minSel').value = s.minSnippetLen;
    el('maxSel').value = s.maxSnippetLen;
    el('timeFormat').value = s.timeFormat || 'local';
    el('allowList').value = fromList(s.allowList);
    el('blockList').value = fromList(s.blockList);
  });
}

function save(){
  const settings = {
    captureInputs: el('captureInputs').checked,
    captureSelections: el('captureSelections').checked,
    maxEvents: Number(el('maxEvents').value) || 1000,
    includeHistoryWindowMinutes: Number(el('historyWindow').value) || 45,
    minSnippetLen: Number(el('minSel').value) || 15,
    maxSnippetLen: Number(el('maxSel').value) || 500,
    timeFormat: el('timeFormat').value,
    allowList: toList(el('allowList').value),
    blockList: toList(el('blockList').value),
  };
  chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings }, (r)=>{
    const msg = document.getElementById('msg');
    msg.textContent = 'Saved';
    msg.hidden = false;
    setTimeout(()=> msg.hidden = true, 1200);
  });
}

function reset(){ chrome.runtime.sendMessage({ type: 'SAVE_SETTINGS', settings: DEFAULTS }, ()=> load()); }
document.getElementById('saveBtn').addEventListener('click', save);
document.getElementById('resetBtn').addEventListener('click', reset);
document.addEventListener('DOMContentLoaded', load);
