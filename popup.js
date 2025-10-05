
const chromeApi = typeof chrome !== 'undefined' ? chrome : null;
const statsEl = document.getElementById('stats');
const copyBtn = document.getElementById('copyBtn');
const copyDropdownToggle = document.getElementById('copyDropdownToggle');
const copyRoleMenu = document.getElementById('copyRoleMenu');
const sendBtn = document.getElementById('sendBtn');
const sendDropdownToggle = document.getElementById('sendDropdownToggle');
const sendRoleMenu = document.getElementById('sendRoleMenu');
const clearBtn = document.getElementById('clearBtn');
const opts = document.getElementById('opts');
const toast = document.getElementById('toast');
const historyBtn = document.getElementById('historyBtn');
const confirmOverlay = document.getElementById('confirmOverlay');
const confirmCancel = document.getElementById('confirmCancel');
const confirmAccept = document.getElementById('confirmAccept');
const kofiBtn = document.getElementById('kofiBtn');
let confirmOpen = false;
const menuContexts = new Set();

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

function withRolePrefix(text, role){
  const prefix = role ? `[Role: ${role}]\n\n` : '';
  return `${prefix}${text}`;
}

function createMenuContext(menuEl, toggleEl){
  if (!menuEl || !toggleEl){
    return {
      open(){},
      close(){},
      isOpen(){ return false; },
      isMenuTarget(){ return false; }
    };
  }
  let open = false;
  const context = {
    open(){
      if (open) return;
      menuContexts.forEach((ctx) => {
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
  menuContexts.add(context);
  return context;
}

function closeAllMenus(){
  let closed = false;
  menuContexts.forEach((ctx) => {
    if (!ctx.isOpen()) return;
    ctx.close();
    closed = true;
  });
  return closed;
}

function handleGlobalMenuDismiss(target){
  if (!(target instanceof Node)) return;
  menuContexts.forEach((ctx) => {
    if (!ctx.isOpen()) return;
    if (ctx.isMenuTarget(target)) return;
    ctx.close();
  });
}

async function copyContextWithRole(role){
  const text = await compose();
  if (!text){
    showToast('Nothing to copy');
    return;
  }
  const payload = withRolePrefix(text, role);
  try {
    await navigator.clipboard.writeText(payload);
    showToast(role ? `Copied as ${role}` : 'Copied context');
  } catch (e){
    console.error(e);
    showToast('Copy failed');
  }
}

async function sendContextWithRole(role){
  const text = await compose();
  if (!text){
    showToast('Nothing to send');
    return;
  }
  if (!chromeApi?.runtime){
    showToast('Only available in extension');
    return;
  }
  const payload = withRolePrefix(text, role);
  try {
    await navigator.clipboard.writeText(payload); // fallback for manual paste if needed
  } catch (e) { /* non-fatal */ }
  chromeApi.runtime.sendMessage({ type: 'OPEN_AND_SEND', text: payload }, (r) => {
    if (r?.ok) showToast(role ? `Opening ChatGPT as ${role}…` : 'Opening ChatGPT…');
    else showToast('Could not open ChatGPT');
  });
}

const copyMenuContext = createMenuContext(copyRoleMenu, copyDropdownToggle);
const sendMenuContext = createMenuContext(sendRoleMenu, sendDropdownToggle);

copyBtn?.addEventListener('click', async () => {
  copyMenuContext.close();
  await copyContextWithRole();
});

sendBtn?.addEventListener('click', async () => {
  sendMenuContext.close();
  await sendContextWithRole();
});

copyDropdownToggle?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (copyMenuContext.isOpen()) copyMenuContext.close();
  else copyMenuContext.open();
});

sendDropdownToggle?.addEventListener('click', (event) => {
  event.stopPropagation();
  if (sendMenuContext.isOpen()) sendMenuContext.close();
  else sendMenuContext.open();
});

copyRoleMenu?.addEventListener('click', async (event) => {
  if (!(event.target instanceof HTMLButtonElement)) return;
  event.stopPropagation();
  const role = event.target.dataset.role;
  copyMenuContext.close();
  await copyContextWithRole(role);
});

sendRoleMenu?.addEventListener('click', async (event) => {
  if (!(event.target instanceof HTMLButtonElement)) return;
  event.stopPropagation();
  const role = event.target.dataset.role;
  sendMenuContext.close();
  await sendContextWithRole(role);
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

document.addEventListener('click', (event) => { handleGlobalMenuDismiss(event.target); });

document.addEventListener('focusin', (event) => { handleGlobalMenuDismiss(event.target); });

document.addEventListener('keydown', (e) => {
  if (e.key === 'Escape'){
    const menuClosed = closeAllMenus();
    if (confirmOpen) hideConfirm();
    if (menuClosed) e.stopPropagation();
  }
});

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

kofiBtn?.addEventListener('click', () => {
  const url = 'https://ko-fi.com/danialbka';
  if (chromeApi?.tabs) {
    chromeApi.tabs.create({ url }, () => {
      if (chromeApi.runtime?.lastError) {
        window.open(url, '_blank', 'noopener,noreferrer');
      } else {
        showToast('Thanks for your support!');
      }
    });
  } else {
    window.open(url, '_blank', 'noopener,noreferrer');
  }
});
refresh();
