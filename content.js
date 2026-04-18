
/* global chrome */

(async function main(){
  const settings = await new Promise(res => chrome.runtime.sendMessage({ type: 'GET_SETTINGS' }, r => res(r.settings)));

  function send(ev){ chrome.runtime.sendMessage({ type: 'EVENT', payload: ev }, ()=>{}); }

  function allowedURL(){
    try{
      if (location.protocol === 'chrome:' || location.protocol === 'chrome-extension:' || location.protocol === 'edge:') return false;
      return true;
    } catch { return false; }
  }
  if (!allowedURL()) return;

  send({ kind: 'page-open', title: document.title, url: location.href });

  if (settings.captureSelections){
    let selTimeout;
    document.addEventListener('mouseup', () => {
      clearTimeout(selTimeout);
      selTimeout = setTimeout(() => {
        const t = window.getSelection()?.toString() || '';
        const maxLen = Number(settings.maxSnippetLen) || 0;
        if (t && t.length >= (settings.minSnippetLen || 0) && (maxLen <= 0 || t.length <= maxLen)){
          send({ kind: 'selection', title: document.title, url: location.href, text: t });
        }
      }, 120);
    });
  }

  if (settings.captureInputs){
    const handler = (e) => {
      try {
        const el = e.target;
        if (!el) return;
        const tag = el.tagName?.toLowerCase();
        let value = '';
        if (tag === 'textarea' || tag === 'input') value = el.value || '';
        else if (el.isContentEditable) value = el.innerText || el.textContent || '';
        if (!value || value.trim().length < 3) return;
        if (el.type === 'password' || el.type === 'hidden') return;
        const label = findLabel(el);
        send({ kind: 'input', title: document.title, url: location.href, value, label });
      } catch {}
    };
    document.addEventListener('change', handler, true);
    document.addEventListener('blur', handler, true);
    let last = 0;
    document.addEventListener('input', (e)=>{
      const now = Date.now();
      if (now - last > 3000) { last = now; handler(e); }
    }, true);
  }

  function findLabel(el){
    try {
      const id = el.id;
      if (id){
        const lab = document.querySelector(`label[for="${CSS.escape(id)}"]`);
        if (lab) return (lab.innerText || lab.textContent || '').trim().slice(0,80);
      }
      const wrapLabel = el.closest('label');
      if (wrapLabel) return (wrapLabel.innerText || wrapLabel.textContent || '').trim().slice(0,80);
      return (el.getAttribute('aria-label') || el.placeholder || el.name || '').slice(0,80);
    } catch { return ''; }
  }
})();
