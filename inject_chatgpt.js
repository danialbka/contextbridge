
// Runs on https://chat.openai.com/*
// Receives { type: 'PASTE_TEXT', text } and tries to place it in the composer.
(()=>{
  function sleep(ms){ return new Promise(r => setTimeout(r, ms)); }

  function findComposer(){
    // Try common selectors (ChatGPT UI changes sometimes)
    const candidates = [
      'textarea',                           // primary composer is often a textarea
      'form textarea',
      'div[contenteditable="true"]',        // fallback
      'form div[contenteditable="true"]',
    ];
    for (const sel of candidates){
      const el = document.querySelector(sel);
      if (el && isVisible(el)) return el;
    }
    return null;
  }

  function isVisible(el){
    const rect = el.getBoundingClientRect();
    return rect.width > 0 && rect.height > 0;
  }

  function setText(el, text){
    if (!el) return false;
    try {
      if (el.tagName && el.tagName.toLowerCase() === 'textarea'){
        el.focus();
        el.value = text;
        el.dispatchEvent(new Event('input', { bubbles: true }));
        el.scrollTop = el.scrollHeight;
        return true;
      }
      if (el.isContentEditable){
        el.focus();
        // Use execCommand for compatibility
        document.execCommand('selectAll', false, null);
        document.execCommand('insertText', false, text);
        el.dispatchEvent(new Event('input', { bubbles: true }));
        return true;
      }
    } catch (e){
      console.warn('setText error', e);
    }
    return false;
  }

  async function pasteText(text){
    // Wait up to ~10s for composer
    for (let i=0;i<50;i++){
      const el = findComposer();
      if (el){
        if (setText(el, text)) return true;
      }
      await sleep(200);
    }
    return false;
  }

  chrome.runtime.onMessage.addListener((msg)=>{
    if (msg?.type === 'PASTE_TEXT'){
      pasteText(msg.text);
    }
  });

  // If a previous script handed off text in a global (not used by default)
  if (window.__CCA_TEXT__) pasteText(window.__CCA_TEXT__);
})();
