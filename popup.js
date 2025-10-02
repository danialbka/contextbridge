
const chromeApi = typeof chrome !== 'undefined' ? chrome : null;
const statsEl = document.getElementById('stats');
const copyBtn = document.getElementById('copyBtn');
const copyDropdownToggle = document.getElementById('copyDropdownToggle');
const copyRoleMenu = document.getElementById('copyRoleMenu');
const sendBtn = document.getElementById('sendBtn');
const clearBtn = document.getElementById('clearBtn');
const opts = document.getElementById('opts');
const toast = document.getElementById('toast');
const historyBtn = document.getElementById('historyBtn');
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmCancel = document.getElementById('confirmCancel');
const confirmAccept = document.getElementById('confirmAccept');
let confirmOpen = false;
let menuOpen = false;

function showToast(msg){
  toast.textContent = msg;
  toast.hidden = false;
  setTimeout(()=> toast.hidden = true, 1400);
}
function fmt(ts){ return new Date(ts).toLocaleString(); }
function refresh(){
  if (!chromeApi?.runtime){
    statsEl.textContent = 'Events unavailable in preview mode.';
    return;
  }
  chromeApi.runtime.sendMessage({ type: 'GET_COUNTS' }, (r)=>{
    if (!r?.ok) return;
    statsEl.textContent = `Events: ${r.count} | Session start: ${fmt(r.startedAt)}`;
  });
}

async function compose(){
  if (!chromeApi?.runtime) return '';
  return new Promise((resolve) => {
    chromeApi.runtime.sendMessage({ type: 'COMPOSE_REPORT' }, (r)=> resolve(r?.text || ''));
  });
}

async function copyContextWithRole(role){
  const text = await compose();
  if (!text){
    showToast('Nothing to copy');
    return;
  }
  const prefix = role ? `[Role: ${role}]\n\n` : '';
  try {
    await navigator.clipboard.writeText(`${prefix}${text}`);
    showToast(role ? `Copied as ${role}` : 'Copied context');
  } catch (e){
    console.error(e);
    showToast('Copy failed');
  }
}

copyBtn.addEventListener('click', async () => {
  await copyContextWithRole();
});

sendBtn.addEventListener('click', async () => {
  const text = await compose();
  if (!chromeApi?.runtime){
    showToast('Only available in extension');
    return;
  }
  try {
    await navigator.clipboard.writeText(text); // fallback for manual paste if needed
  } catch (e) { /* non-fatal */ }
  chromeApi.runtime.sendMessage({ type: 'OPEN_AND_SEND', text }, (r) => {
    if (r?.ok) showToast('Opening ChatGPT…');
    else showToast('Could not open ChatGPT');
  });
});

function closeMenu(){
  if (!menuOpen) return;
  menuOpen = false;
  copyRoleMenu.hidden = true;
  copyDropdownToggle.setAttribute('aria-expanded', 'false');
}

function openMenu(){
  if (menuOpen) return;
  menuOpen = true;
  copyRoleMenu.hidden = false;
  copyDropdownToggle.setAttribute('aria-expanded', 'true');
}

copyDropdownToggle?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (menuOpen) closeMenu();
  else openMenu();
});

copyRoleMenu?.addEventListener('click', async (event) => {
  if (!(event.target instanceof HTMLButtonElement)) return;
  event.stopPropagation();
  const role = event.target.dataset.role;
  closeMenu();
  await copyContextWithRole(role);
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
  if (!chromeApi?.runtime) return;
  hideConfirm();
  chromeApi.runtime.sendMessage({ type: 'CLEAR_EVENTS' }, (r)=>{
    if (r?.ok) { refresh(); showToast('Erased'); }
  });
});

confirmOverlay.addEventListener('click', (e) => {
  if (e.target === confirmOverlay) hideConfirm();
});

document.addEventListener('keydown', (e) => {
  if (confirmOpen && e.key === 'Escape') hideConfirm();
  if (menuOpen && e.key === 'Escape') closeMenu();
});

document.addEventListener('click', () => { closeMenu(); });

opts.addEventListener('click', () => {
  if (!chromeApi?.runtime) return;
  chromeApi.runtime.openOptionsPage();
});

historyBtn.addEventListener('click', () => {
  if (!chromeApi?.runtime) {
    showToast('Only available in extension');
    return;
  }
  const url = chromeApi.runtime.getURL('history.html');
  chromeApi.tabs.create({ url }, () => {
    if (chromeApi.runtime.lastError) {
      console.error('History open failed', chromeApi.runtime.lastError);
      showToast('Unable to open history');
      return;
    }
    showToast('History opened');
  });
});
refresh();
