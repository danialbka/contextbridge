const encoder = new TextEncoder();

function hashString(value){
  if (typeof value !== 'string' || !value) return '0';
  const bytes = encoder.encode(value);
  let hash = 0;
  for (let i = 0; i < bytes.length; i += 1){
    hash = ((hash << 5) - hash + bytes[i]) | 0; // eslint-disable-line no-bitwise
  }
  return hash.toString();
}

export function buildGraph(session){
  const graph = { pages: {} };
  if (!session || !Array.isArray(session.events)) return graph;

  session.events.forEach((ev) => {
    if (!ev || ev.type !== 'click') return;
    const pageUrl = ev.pageUrl || ev.url || 'unknown';
    if (!graph.pages[pageUrl]){
      graph.pages[pageUrl] = { title: ev.title, nodes: {} };
    }
    const page = graph.pages[pageUrl];
    const id = hashString(`${ev.selector || ''}|${ev.title || ''}|${pageUrl}`);
    if (!page.nodes[id]){
      page.nodes[id] = {
        id,
        pageUrl,
        title: ev.title,
        selector: ev.selector || '',
        text: ev.text || '',
        clicks: 0,
        coordsSamples: [],
        roles: [],
        weights: {},
      };
    }
    const node = page.nodes[id];
    node.clicks += 1;
    if (ev.coords && typeof ev.coords.x === 'number' && typeof ev.coords.y === 'number'){
      node.coordsSamples.push({ x: ev.coords.x, y: ev.coords.y });
    }
  });

  Object.values(graph.pages).forEach((page) => {
    Object.values(page.nodes).forEach((node) => {
      const selector = (node.selector || '').toLowerCase();
      const text = (node.text || '').toLowerCase();
      const roles = [];

      if (selector.includes('button') || /(^|[^a-z])btn([^a-z]|$)/.test(selector)) roles.push(['button', 3]);
      if (selector.includes('a>') || selector.includes('a.yt-') || selector.endsWith(' a')) roles.push(['link', 2]);
      if (selector.includes('input') || selector.includes('textarea')) roles.push(['input', 3]);
      if (selector.includes('nav') || selector.includes('menu')) roles.push(['nav', 2]);
      if (selector.includes('header') || selector.includes('ytp-chrome-controls')) roles.push(['toolbar', 2]);
      if (selector.includes('slider') || text.includes('volume')) roles.push(['slider', 3]);
      if (text.includes('subscribe') || text.includes('add to') || text.includes('buy')) roles.push(['cta', 2]);

      if (/play|pause|mute|volume/.test(text)) roles.push(['media-control', 3]);
      if (/openai|settings|profile|login|signin|logout/.test(text)) roles.push(['nav', 1]);

      roles.push(['high-engagement', Math.min(node.clicks, 5)]);

      roles.forEach(([role, weight]) => {
        node.weights[role] = (node.weights[role] || 0) + weight;
      });
      node.roles = Object.entries(node.weights)
        .sort((a, b) => b[1] - a[1])
        .map(([role]) => role);
    });
  });

  return graph;
}

export function summarizeGraph(graph){
  const pages = graph?.pages || {};
  const pageEntries = Object.entries(pages);
  const pageCount = pageEntries.length;
  let nodeCount = 0;
  const topPages = pageEntries.map(([url, page]) => {
    const count = Object.keys(page.nodes || {}).length;
    nodeCount += count;
    return { url, title: page.title || '', nodeCount: count };
  }).sort((a, b) => b.nodeCount - a.nodeCount);
  return { pageCount, nodeCount, topPages };
}
