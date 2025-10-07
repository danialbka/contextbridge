export function emitPatch(selector, adjustment, probe){
  if (!selector || !adjustment) throw new Error('selector and adjustment required');
  const format = 'inline-js';

  const createWrapper = (body) => `(() => {${body}})();`;

  if (adjustment.kind === 'center'){
    const axis = adjustment.axis || 'x';
    const parentDisplay = String(probe?.parent?.display || '');
    const elDisplay = String(probe?.el?.display || '');
    const elPosition = String(probe?.el?.position || '');

    if (parentDisplay.includes('flex')){
      const body = [
        "const parent = document.querySelector('" + selector + "')?.parentElement;",
        'if (!parent) return;',
        "parent.style.setProperty('justify-content','center','important');",
        axis !== 'x' ? "parent.style.setProperty('align-items','center','important');" : '',
      ].filter(Boolean).join('');
      return {
        selector,
        format,
        code: createWrapper(body),
        rationale: 'center via parent flex',
      };
    }

    if (parentDisplay.includes('grid')){
      const body = [
        "const parent = document.querySelector('" + selector + "')?.parentElement;",
        'if (!parent) return;',
        "parent.style.setProperty('place-items','center','important');",
      ].join('');
      return {
        selector,
        format,
        code: createWrapper(body),
        rationale: 'center via parent grid',
      };
    }

    if (elDisplay.includes('inline')){
      const body = [
        "const parent = document.querySelector('" + selector + "')?.parentElement;",
        'if (!parent) return;',
        "parent.style.setProperty('text-align','center','important');",
      ].join('');
      return {
        selector,
        format,
        code: createWrapper(body),
        rationale: 'center via text-align',
      };
    }

    if (elPosition === 'absolute' || elPosition === 'fixed'){
      const body = [
        "const el = document.querySelector('" + selector + "');",
        'if (!el) return;',
        "el.style.setProperty('left','50%','important');",
        "const current = getComputedStyle(el).transform;",
        "const next = current && current !== 'none' ? current + ' translateX(-50%)' : 'translateX(-50%)';",
        "el.style.setProperty('transform', next,'important');",
      ].join('');
      return {
        selector,
        format,
        code: createWrapper(body),
        rationale: 'center via absolute+translateX',
      };
    }

    const body = [
      "const parent = document.querySelector('" + selector + "')?.parentElement;",
      'if (!parent) return;',
      "parent.style.setProperty('display','flex','important');",
      "parent.style.setProperty('justify-content','center','important');",
      axis !== 'x' ? "parent.style.setProperty('align-items','center','important');" : '',
    ].filter(Boolean).join('');
    return {
      selector,
      format,
      code: createWrapper(body),
      rationale: 'force parent flex (fallback)',
    };
  }

  if (adjustment.kind === 'spacing'){
    const body = [
      "const el = document.querySelector('" + selector + "');",
      'if (!el) return;',
      adjustment.margin ? "el.style.setProperty('margin','" + adjustment.margin + "','important');" : '',
      adjustment.padding ? "el.style.setProperty('padding','" + adjustment.padding + "','important');" : '',
    ].filter(Boolean).join('');
    return {
      selector,
      format,
      code: createWrapper(body),
      rationale: 'spacing update',
    };
  }

  if (adjustment.kind === 'size'){
    const body = [
      "const el = document.querySelector('" + selector + "');",
      'if (!el) return;',
      adjustment.width ? "el.style.setProperty('width','" + adjustment.width + "','important');" : '',
      adjustment.height ? "el.style.setProperty('height','" + adjustment.height + "','important');" : '',
      adjustment.maxWidth ? "el.style.setProperty('max-width','" + adjustment.maxWidth + "','important');" : '',
    ].filter(Boolean).join('');
    return { selector, format, code: createWrapper(body), rationale: 'size update' };
  }

  if (adjustment.kind === 'typography'){
    const body = [
      "const el = document.querySelector('" + selector + "');",
      'if (!el) return;',
      adjustment.fontSize ? "el.style.setProperty('font-size','" + adjustment.fontSize + "','important');" : '',
      adjustment.fontWeight ? "el.style.setProperty('font-weight','" + adjustment.fontWeight + "','important');" : '',
      adjustment.textAlign ? "el.style.setProperty('text-align','" + adjustment.textAlign + "','important');" : '',
    ].filter(Boolean).join('');
    return { selector, format, code: createWrapper(body), rationale: 'typography update' };
  }

  if (adjustment.kind === 'color'){
    const body = [
      "const el = document.querySelector('" + selector + "');",
      'if (!el) return;',
      adjustment.color ? "el.style.setProperty('color','" + adjustment.color + "','important');" : '',
      adjustment.bg ? "el.style.setProperty('background-color','" + adjustment.bg + "','important');" : '',
      adjustment.borderColor ? "el.style.setProperty('border-color','" + adjustment.borderColor + "','important');" : '',
    ].filter(Boolean).join('');
    return { selector, format, code: createWrapper(body), rationale: 'color update' };
  }

  if (adjustment.kind === 'visibility'){
    const body = [
      "const el = document.querySelector('" + selector + "');",
      'if (!el) return;',
      adjustment.display ? "el.style.setProperty('display','" + adjustment.display + "','important');" : '',
    ].filter(Boolean).join('');
    return { selector, format, code: createWrapper(body), rationale: 'visibility update' };
  }

  if (adjustment.kind === 'zindex'){
    const body = [
      "const el = document.querySelector('" + selector + "');",
      'if (!el) return;',
      "el.style.setProperty('z-index','" + adjustment.zIndex + "','important');",
    ].join('');
    return { selector, format, code: createWrapper(body), rationale: 'z-index update' };
  }

  if (adjustment.kind === 'layout'){
    const body = [
      "const el = document.querySelector('" + selector + "');",
      'if (!el) return;',
      adjustment.display ? "el.style.setProperty('display','" + adjustment.display + "','important');" : '',
      adjustment.justifyContent ? "el.style.setProperty('justify-content','" + adjustment.justifyContent + "','important');" : '',
      adjustment.alignItems ? "el.style.setProperty('align-items','" + adjustment.alignItems + "','important');" : '',
      adjustment.placeItems ? "el.style.setProperty('place-items','" + adjustment.placeItems + "','important');" : '',
    ].filter(Boolean).join('');
    return { selector, format, code: createWrapper(body), rationale: 'layout update' };
  }

  throw new Error('unknown adjustment');
}
