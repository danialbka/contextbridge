
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

  const developerMode = !!settings.developerDebugMode;

  send({ kind: 'page-open', title: document.title, url: location.href });

  if (developerMode){
    setupDeveloperDebug(send);
  }

  if (settings.captureSelections){
    let selTimeout;
    document.addEventListener('mouseup', () => {
      clearTimeout(selTimeout);
      selTimeout = setTimeout(() => {
        const t = window.getSelection()?.toString() || '';
        if (t && t.length >= settings.minSnippetLen && t.length <= settings.maxSnippetLen){
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

function setupDeveloperDebug(send){
  const pageUrl = () => location.href;
  const pageTitle = () => document.title;
  const ELEMENT_NODE = typeof Node === 'undefined' ? 1 : Node.ELEMENT_NODE;

  const CLICK_SESSION_MS = 5000;
  let activeClickId = null;
  let clickTimer = null;

  function setActiveClick(id){
    activeClickId = id;
    if (clickTimer) clearTimeout(clickTimer);
    clickTimer = setTimeout(() => { activeClickId = null; }, CLICK_SESSION_MS);
  }

  function debugSend(payload){
    const event = {
      ts: Date.now(),
      pageUrl: pageUrl(),
      title: pageTitle(),
      debugOnly: true,
      ...payload,
    };
    if (!event.type) return;
    try {
      send(event);
    } catch {
      /* ignore */
    }
  }

  function resolveUrl(url){
    try {
      return new URL(url, pageUrl()).href;
    } catch {
      return '';
    }
  }

  function elSelector(el){
    if (!el || el === document || el === window) return '';
    if (el.id) return `#${el.id}`;
    const parts = [];
    let node = el;
    while (node && node.nodeType === ELEMENT_NODE && parts.length < 5){
      const tag = (node.tagName || '').toLowerCase();
      if (!tag) break;
      let selector = tag;
      if (node.classList && node.classList.length){
        selector += '.' + Array.from(node.classList).slice(0,2).map((cls) => cls.replace(/\s+/g,'-')).join('.');
      }
      const parent = node.parentElement;
      if (parent){
        const siblings = Array.from(parent.children).filter((c) => c.tagName === node.tagName);
        if (siblings.length > 1){
          const index = siblings.indexOf(node) + 1;
          selector += `:nth-of-type(${index})`;
        }
      }
      parts.unshift(selector);
      node = parent;
    }
    return parts.join(' > ');
  }

  function elText(el){
    if (!el) return '';
    const text = (el.innerText || el.textContent || '').trim();
    return text.length > 120 ? `${text.slice(0,117)}…` : text;
  }

  document.addEventListener('click', (event) => {
    try {
      const id = `clk_${crypto.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
      setActiveClick(id);
      const target = event.target || event.srcElement;
      debugSend({
        type: 'click',
        id,
        selector: elSelector(target),
        text: elText(target),
        url: pageUrl(),
        title: pageTitle(),
        coords: { x: event.clientX, y: event.clientY },
      });
    } catch {
      /* ignore */
    }
  }, true);

  const originalFetch = window.fetch;
  if (typeof originalFetch === 'function' && !originalFetch.__ccaDebugWrapped){
    const patchedFetch = function patchedFetch(input, init){
      const started = Date.now();
      const clickId = activeClickId;
      let method = 'GET';
      let targetUrl = '';
      try {
        if (typeof input === 'string'){ targetUrl = input; }
        else if (input && typeof input === 'object'){ targetUrl = input.url || ''; method = input.method || method; }
        if (init && typeof init.method === 'string'){ method = init.method; }
      } catch {}
      const resolvedUrl = resolveUrl(targetUrl);
      const sendNet = (status, extra = {}) => {
        debugSend({
          type: 'net',
          click_id: clickId || undefined,
          kind: 'fetch',
          method,
          url: resolvedUrl || targetUrl || pageUrl(),
          status,
          dur_ms: Date.now() - started,
          redacted: true,
          ...extra,
        });
      };
      const exec = originalFetch.__ccaDebugOriginal || originalFetch;
      return exec.apply(this, arguments)
        .then((response) => {
          try {
            const lengthHeader = response?.headers?.get?.('content-length');
            const bytes = lengthHeader ? Number(lengthHeader) : undefined;
            sendNet(response?.status ?? 0, bytes ? { resp_bytes: bytes } : {});
          } catch {
            sendNet(response?.status ?? 0);
          }
          return response;
        })
        .catch((error) => {
          sendNet('ERR', { message: error ? String(error) : undefined });
          throw error;
        });
    };
    patchedFetch.__ccaDebugWrapped = true;
    patchedFetch.__ccaDebugOriginal = originalFetch.__ccaDebugOriginal || originalFetch;
    window.fetch = patchedFetch;
  }

  if (window.XMLHttpRequest){
    const proto = XMLHttpRequest.prototype;
    if (!proto.open.__ccaDebugWrapped){
      const origOpen = proto.open;
      const wrappedOpen = function(method, url){
        this.__ccaDebug = {
          method: method ? String(method).toUpperCase() : 'GET',
          url: url ? String(url) : '',
        };
        return (origOpen.__ccaDebugOriginal || origOpen).apply(this, arguments);
      };
      wrappedOpen.__ccaDebugWrapped = true;
      wrappedOpen.__ccaDebugOriginal = origOpen.__ccaDebugOriginal || origOpen;
      proto.open = wrappedOpen;
    }
    if (!proto.send.__ccaDebugWrapped){
      const origSend = proto.send;
      const wrappedSend = function(){
        const started = Date.now();
        const clickId = activeClickId;
        const meta = this.__ccaDebug || { method: 'GET', url: '' };
        const resolvedUrl = resolveUrl(meta.url);
        const finish = (status, extra = {}) => {
          debugSend({
            type: 'net',
            click_id: clickId || undefined,
            kind: 'xhr',
            method: meta.method,
            url: resolvedUrl || meta.url || pageUrl(),
            status,
            dur_ms: Date.now() - started,
            redacted: true,
            ...extra,
          });
        };
        const done = () => finish(this.status ?? 0);
        this.addEventListener('loadend', done, { once: true });
        this.addEventListener('error', () => finish('ERR'), { once: true });
        this.addEventListener('abort', () => finish('ABORT'), { once: true });
        return (origSend.__ccaDebugOriginal || origSend).apply(this, arguments);
      };
      wrappedSend.__ccaDebugWrapped = true;
      wrappedSend.__ccaDebugOriginal = origSend.__ccaDebugOriginal || origSend;
      proto.send = wrappedSend;
    }
  }

  (function patchConsole(){
    const levels = ['log','info','warn','error','debug'];
    levels.forEach((level) => {
      const original = console[level];
      if (typeof original !== 'function' || original.__ccaDebugWrapped) return;
      console[level] = function patchedConsole(){
        try {
          const msg = Array.from(arguments).map((arg) => {
            if (typeof arg === 'string') return arg;
            if (typeof arg === 'object'){
              try { return JSON.stringify(arg); } catch { return String(arg); }
            }
            return String(arg);
          }).join(' ');
          debugSend({
            type: 'console',
            level,
            msg,
            click_id: activeClickId || undefined,
          });
        } catch {
          /* ignore */
        }
        return original.apply(this, arguments);
      };
      console[level].__ccaDebugWrapped = true;
      console[level].__ccaDebugOriginal = original;
    });
  })();

  window.addEventListener('error', (event) => {
    try {
      const stack = event?.error?.stack || event?.filename;
      debugSend({
        type: 'error',
        level: 'error',
        msg: event?.message || 'Error',
        stack,
        src: event?.filename,
        line: event?.lineno,
        col: event?.colno,
        click_id: activeClickId || undefined,
      });
    } catch {
      /* ignore */
    }
  }, true);

  window.addEventListener('unhandledrejection', (event) => {
    try {
      const reason = event?.reason;
      let message = 'Unhandled rejection';
      if (typeof reason === 'string') message = reason;
      else if (reason && typeof reason.message === 'string') message = reason.message;
      else if (typeof reason !== 'undefined') {
        try { message = JSON.stringify(reason); }
        catch { message = String(reason); }
      }
      debugSend({
        type: 'error',
        level: 'error',
        msg: message || 'Unhandled rejection',
        stack: reason && reason.stack ? reason.stack : undefined,
        click_id: activeClickId || undefined,
      });
    } catch {
      /* ignore */
    }
  });

  let lastRoute = pageUrl();
  function sendRoute(to, mode){
    const from = lastRoute;
    lastRoute = to;
    debugSend({
      type: 'route',
      from,
      to,
      mode,
      click_id: activeClickId || undefined,
    });
  }
  const origPushState = history.pushState;
  if (typeof origPushState === 'function' && !origPushState.__ccaDebugWrapped){
    const wrappedPush = function(state, title, url){
      const executor = origPushState.__ccaDebugOriginal || origPushState;
      const result = executor.apply(this, arguments);
      const to = url ? resolveUrl(url) || lastRoute : pageUrl();
      sendRoute(to, 'pushState');
      return result;
    };
    wrappedPush.__ccaDebugWrapped = true;
    wrappedPush.__ccaDebugOriginal = origPushState.__ccaDebugOriginal || origPushState;
    history.pushState = wrappedPush;
  }
  const origReplaceState = history.replaceState;
  if (typeof origReplaceState === 'function' && !origReplaceState.__ccaDebugWrapped){
    const wrappedReplace = function(state, title, url){
      const executor = origReplaceState.__ccaDebugOriginal || origReplaceState;
      const result = executor.apply(this, arguments);
      const to = url ? resolveUrl(url) || pageUrl() : pageUrl();
      sendRoute(to, 'replaceState');
      return result;
    };
    wrappedReplace.__ccaDebugWrapped = true;
    wrappedReplace.__ccaDebugOriginal = origReplaceState.__ccaDebugOriginal || origReplaceState;
    history.replaceState = wrappedReplace;
  }
  window.addEventListener('popstate', () => {
    sendRoute(pageUrl(), 'popstate');
  });
  window.addEventListener('hashchange', () => {
    const current = pageUrl();
    sendRoute(current, 'hashchange');
  });

  try {
    if (typeof PerformanceObserver === 'function'){
      const perfObserver = new PerformanceObserver((list) => {
        list.getEntries().forEach((entry) => {
          if (entry.entryType === 'longtask'){
            debugSend({
              type: 'perf',
              metric: 'longtask',
              value_ms: entry.duration,
              click_id: activeClickId || undefined,
            });
          }
        });
      });
      perfObserver.observe({ entryTypes: ['longtask'] });
    }
    const paints = performance?.getEntriesByType?.('paint') || [];
    paints.forEach((entry) => {
      debugSend({
        type: 'perf',
        metric: entry.name,
        value_ms: entry.startTime,
        click_id: activeClickId || undefined,
      });
    });
  } catch {
    /* ignore */
  }
}
