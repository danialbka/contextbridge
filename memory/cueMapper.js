import { tokenize, normalizeText } from './utils.js';

const INTENT_KEYWORDS = [
  { intent: 'debug', tokens: ['debug', 'error', 'bug', 'issue', 'fix'] },
  { intent: 'plan', tokens: ['plan', 'roadmap', 'outline', 'strategy'] },
  { intent: 'write', tokens: ['write', 'draft', 'compose', 'email', 'message'] },
  { intent: 'summarize', tokens: ['summarize', 'summary', 'recap'] },
  { intent: 'research', tokens: ['research', 'investigate', 'learn'] },
];

function detectIntent(terms){
  for (const item of INTENT_KEYWORDS){
    if (item.tokens.some((token) => terms.includes(token))) return item.intent;
  }
  return null;
}

function extractEntities(text){
  const matches = text.match(/([A-Z][a-z0-9]+(?:\s+[A-Z][a-z0-9]+)*)/g);
  if (!matches) return [];
  return Array.from(new Set(matches.map((m) => m.trim())));
}

export function extractCues(prompt, uiCtx = {}){
  const normalizedPrompt = normalizeText(prompt);
  const terms = tokenize(prompt);
  const intent = detectIntent(terms);
  const entities = extractEntities(normalizedPrompt);
  return {
    prompt: normalizedPrompt,
    terms,
    intent,
    entities,
    route: uiCtx.route || null,
    timezone: uiCtx.tz || null,
    recentProjectId: uiCtx.recentProjectId || null,
    timestamp: uiCtx.timestamp || Date.now(),
  };
}

export function buildQueries(cues){
  const semantic = {
    embedding: cues.embedding || null,
    terms: cues.terms,
  };
  const symbolic = {
    intent: cues.intent,
    route: cues.route,
    entities: cues.entities,
  };
  return { semantic, symbolic };
}
