export const LAYOUT_PROBE_SNIPPET = `window.__probe = (sel) => {
  const el = document.querySelector(sel);
  if (!el) return { ok: false, error: 'not found' };
  const p = el.parentElement;
  const cs = (n) => (n ? getComputedStyle(n) : null);
  const es = cs(el);
  const ps = cs(p);
  const rect = el.getBoundingClientRect();
  const prect = p?.getBoundingClientRect();
  const pick = (s, keys) => Object.fromEntries(keys.map((k) => [k, s?.getPropertyValue(k) ?? null]));
  return {
    ok: true,
    selector: sel,
    bbox: { x: rect.x, y: rect.y, w: rect.width, h: rect.height },
    parentBbox: prect ? { x: prect.x, y: prect.y, w: prect.width, h: prect.height } : null,
    el: pick(es, ['display','position','float','margin-left','margin-right','text-align','transform']),
    parent: pick(ps, ['display','position','justify-content','align-items','place-items','text-align']),
  };
};`;
