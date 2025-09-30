
/* global chrome */
const statsEl = document.getElementById('stats');
const copyBtn = document.getElementById('copyBtn');
const sendBtn = document.getElementById('sendBtn');
const clearBtn = document.getElementById('clearBtn');
const opts = document.getElementById('opts');
const toast = document.getElementById('toast');
const historyBtn = document.getElementById('historyBtn');
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmCancel = document.getElementById('confirmCancel');
const confirmAccept = document.getElementById('confirmAccept');
let confirmOpen = false;

function showToast(msg){
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(()=> toast.hidden = true, 1400);
}
function fmt(ts){ return new Date(ts).toLocaleString(); }
function refresh(){
  chrome.runtime.sendMessage({ type: 'GET_COUNTS' }, (r)=>{
    if (!r?.ok) return;
    statsEl.textContent = `Events: ${r.count} | Session start: ${fmt(r.startedAt)}`;
  });
}

async function compose(){
  return new Promise((resolve) => {
    chrome.runtime.sendMessage({ type: 'COMPOSE_REPORT' }, (r)=> resolve(r?.text || ''));
  });
}

copyBtn.addEventListener('click', async () => {
  const text = await compose();
  try {
    await navigator.clipboard.writeText(text);
    showToast('Copied context');
  } catch (e){
    console.error(e);
    showToast('Copy failed');
  }
});

sendBtn.addEventListener('click', async () => {
  const text = await compose();
  try {
    await navigator.clipboard.writeText(text); // fallback for manual paste if needed
  } catch (e) { /* non-fatal */ }
  chrome.runtime.sendMessage({ type: 'OPEN_AND_SEND', text }, (r) => {
    if (r?.ok) showToast('Opening ChatGPT…');
    else showToast('Could not open ChatGPT');
  });
});

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

clearBtn.addEventListener('click', () => { showConfirm(); });

confirmCancel.addEventListener('click', () => { hideConfirm(); });

confirmAccept.addEventListener('click', () => {
  hideConfirm();
  chrome.runtime.sendMessage({ type: 'CLEAR_EVENTS' }, (r)=>{
    if (r?.ok) { refresh(); showToast('Erased'); }
  });
});

confirmOverlay.addEventListener('click', (e) => {
  if (e.target === confirmOverlay) hideConfirm();
});

document.addEventListener('keydown', (e) => {
  if (confirmOpen && e.key === 'Escape') hideConfirm();
});

opts.addEventListener('click', () => { chrome.runtime.openOptionsPage(); });
historyBtn.addEventListener('click', () => {
  const url = chrome.runtime.getURL('history.html');
  chrome.tabs.create({ url }, () => {
    if (chrome.runtime.lastError) {
      console.error('History open failed', chrome.runtime.lastError);
      showToast('Unable to open history');
      return;
    }
    showToast('History opened');
  });
});
refresh();
