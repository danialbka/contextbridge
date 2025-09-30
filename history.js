/* global chrome */

const linksEl = document.getElementById('dayLinks');
const sectionsEl = document.getElementById('daySections');
const loadingEl = document.getElementById('loading');
const emptyEl = document.getElementById('empty');
const refreshBtn = document.getElementById('refreshBtn');
const clearHistoryBtn = document.getElementById('clearHistoryBtn');
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmClear = document.getElementById('confirmClear');
const cancelClear = document.getElementById('cancelClear');
let confirmOpen = false;

function setLoading(isLoading){
  loadingEl.hidden = !isLoading;
}

function showEmpty(show){
  emptyEl.hidden = !show;
  linksEl.hidden = show;
}

function clearView(){
  linksEl.innerHTML = '';
  sectionsEl.innerHTML = '';
}

function renderDays(days){
  clearView();
  if (!days.length){
    showEmpty(true);
    return;
  }

  showEmpty(false);
  const sorted = [...days].sort((a,b)=>b.sortValue - a.sortValue);

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

  const copyBtn = document.createElement('button');
  copyBtn.textContent = 'Copy Day';
  copyBtn.type = 'button';

  const sendBtn = document.createElement('button');
  sendBtn.textContent = 'Send to ChatGPT';
  sendBtn.type = 'button';
  sendBtn.classList.add('ghost');

  const status = document.createElement('span');
  status.className = 'action-status';
  status.textContent = '';

  copyBtn.addEventListener('click', async () => {
    status.textContent = 'Copying…';
    try {
      await navigator.clipboard.writeText(day.text);
      status.textContent = 'Copied';
    } catch (e){
      console.error('Copy failed', e);
      status.textContent = 'Copy failed';
    }
    setTimeout(() => { status.textContent = ''; }, 1800);
  });

  sendBtn.addEventListener('click', async () => {
    status.textContent = 'Sending…';
    try {
      await navigator.clipboard.writeText(day.text);
    } catch (e) {
      console.debug('Clipboard write failed (non-fatal)', e);
    }
    chrome.runtime.sendMessage({ type: 'OPEN_AND_SEND', text: day.text }, (resp) => {
      if (chrome.runtime.lastError || !resp?.ok) {
        console.error('Send failed', chrome.runtime.lastError || resp);
        status.textContent = 'Send failed';
      } else {
        status.textContent = 'Sent';
      }
      setTimeout(() => { status.textContent = ''; }, 1800);
    });
  });

  buttons.appendChild(copyBtn);
  buttons.appendChild(sendBtn);
  controls.appendChild(buttons);
  controls.appendChild(status);
  header.appendChild(controls);
  article.appendChild(header);

  const pre = document.createElement('pre');
  pre.textContent = day.lines.join('\n');
  article.appendChild(pre);

  return article;
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
clearHistoryBtn.addEventListener('click', () => showConfirm());
cancelClear.addEventListener('click', () => hideConfirm());
confirmOverlay.addEventListener('click', (e) => { if (e.target === confirmOverlay) hideConfirm(); });
document.addEventListener('keydown', (e) => { if (confirmOpen && e.key === 'Escape') hideConfirm(); });
confirmClear.addEventListener('click', async () => {
  hideConfirm();
  await clearHistoryWindow();
});

document.addEventListener('DOMContentLoaded', () => loadDays());
