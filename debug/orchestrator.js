import { buildGraph } from './reconstructor.js';
import { emitPatch } from './actions.js';

export function chooseTargetForInstruction(graph, instruction){
  if (!graph || !graph.pages) return null;
  const candidates = [];
  const wantButton = /button|cta|center|align/i.test(instruction || '');

  Object.entries(graph.pages).forEach(([pageUrl, page]) => {
    Object.values(page.nodes || {}).forEach((node) => {
      const text = String(node.text || '').toLowerCase();
      const selector = String(node.selector || '').toLowerCase();
      const roleScore = wantButton && (node.roles?.includes('button') || node.roles?.includes('cta')) ? 5 : 0;
      const textBoost = text.includes('submit') ? 2 : 0;
      const selectorBoost = selector.includes('button') ? 2 : 0;
      const score = Number(node.clicks || 0) + roleScore + textBoost + selectorBoost;
      candidates.push({ pageUrl, node, score });
    });
  });

  candidates.sort((a, b) => b.score - a.score);
  return candidates[0] || null;
}

export function planAdjustment(instruction){
  const input = String(instruction || '').toLowerCase();
  if (input.includes('center')){
    return { kind: 'center', axis: input.includes('vertical') || input.includes('both') ? 'both' : 'x' };
  }
  if (input.includes('bigger') || input.includes('width') || input.includes('height')){
    return { kind: 'size', width: input.includes('width') ? 'min(100%, 320px)' : undefined, height: undefined };
  }
  if (input.includes('padding') || input.includes('margin')){
    return {
      kind: 'spacing',
      margin: input.includes('margin') ? '1rem' : undefined,
      padding: input.includes('padding') ? '0.75rem 1rem' : undefined,
    };
  }
  if (input.includes('bold') || input.includes('font')){
    return {
      kind: 'typography',
      fontWeight: '600',
      textAlign: input.includes('center') ? 'center' : undefined,
    };
  }
  if (input.includes('color') || input.includes('bg') || input.includes('background')){
    return {
      kind: 'color',
      color: input.includes('white') ? '#ffffff' : undefined,
      bg: input.includes('primary') ? '#2563eb' : undefined,
    };
  }
  if (input.includes('hide') || input.includes('remove')){
    return { kind: 'visibility', display: 'none' };
  }
  if (input.includes('grid') || input.includes('flex')){
    return {
      kind: 'layout',
      display: input.includes('grid') ? 'grid' : 'flex',
      justifyContent: 'center',
      alignItems: 'center',
    };
  }
  if (input.includes('front')){
    return { kind: 'zindex', zIndex: 1000 };
  }
  return { kind: 'center', axis: 'x' };
}

export function makePatchFromTimeline(session, instruction, probe){
  if (!session) throw new Error('session required');
  const graph = buildGraph(session);
  const target = chooseTargetForInstruction(graph, instruction);
  if (!target) throw new Error('No target element inferred');
  const adjustment = planAdjustment(instruction);
  const patch = emitPatch(target.node.selector, adjustment, probe);
  return {
    patch,
    target,
    adjustment,
    graphSummary: {
      pageUrl: target.pageUrl,
      selector: target.node.selector,
      roles: target.node.roles || [],
      clicks: target.node.clicks || 0,
    },
  };
}
