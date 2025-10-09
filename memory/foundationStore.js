/* global chrome */
import { FOUNDATION_STORAGE_KEY } from './constants.js';
import { hashText, nowTs, normalizeText, tokenize, uniqueId } from './utils.js';
import { recordWitness } from './auditTrail.js';
import { upsertRecallEntry, removeRecallEntriesFor } from './recallIndex.js';

async function readFoundationItems(){
  const { [FOUNDATION_STORAGE_KEY]: items } = await chrome.storage.local.get(FOUNDATION_STORAGE_KEY);
  if (!Array.isArray(items)) return [];
  return items.map((item) => ({ ...item }));
}

async function writeFoundationItems(items){
  await chrome.storage.local.set({ [FOUNDATION_STORAGE_KEY]: items });
}

function withDerivedFields(item){
  const tokens = tokenize(item.content);
  return { ...item, tokens };
}

export async function listFoundationItems(){
  const items = await readFoundationItems();
  return items.map(withDerivedFields).sort((a, b) => (b.createdAt || 0) - (a.createdAt || 0));
}

function scoreFoundationItem(item, cues){
  if (!item || !cues) return 0;
  const tokens = new Set(item.tokens || tokenize(item.content));
  if (!tokens.size) return 0;
  let overlap = 0;
  const terms = cues.terms || [];
  terms.forEach((term) => {
    if (tokens.has(term)) overlap += 1;
  });
  const base = overlap / Math.max(tokens.size, 1);
  if (cues.intent && item.intentTag === cues.intent) return base + 0.25;
  return base;
}

export async function selectFoundationItems(cues, limit = 3){
  const items = await listFoundationItems();
  const scored = items
    .map((item) => ({ item, score: scoreFoundationItem(item, cues) + (item.pinned ? 0.2 : 0) }))
    .sort((a, b) => b.score - a.score);
  const chosen = scored.slice(0, limit).map(({ item }) => item);
  return chosen;
}

export async function appendFoundationItem(data, options = {}){
  const confirmed = options.confirmed === true;
  const content = normalizeText(data?.content);
  if (!content){
    return { ok: false, error: 'content_required' };
  }
  const kind = data?.kind || 'fact';
  const source = data?.source || 'system';
  const intentTag = data?.intentTag || null;
  const createdAt = nowTs();
  const hash = await hashText(`${kind}:${content}`);
  const all = await readFoundationItems();
  const duplicate = all.find((item) => item.hash === hash && !item.supersededAt);
  const baseRecord = {
    id: uniqueId('foundation'),
    kind,
    content,
    source,
    createdAt,
    hash,
    intentTag,
    supersedesId: data?.supersedesId || null,
    supersededAt: null,
    pinned: !!data?.pinned,
  };
  if (!confirmed){
    return { ok: false, confirmationRequired: true, proposal: baseRecord };
  }
  if (duplicate){
    return { ok: false, error: 'duplicate_content', item: duplicate };
  }
  const toWrite = [...all, baseRecord];
  await writeFoundationItems(toWrite);
  await recordWitness({ layer: 'foundation', op: 'append', payloadHash: hash });
  await upsertRecallEntry({
    layer: 'foundation',
    itemId: baseRecord.id,
    summary: content,
    embedding: data?.embedding || null,
    salience: data?.salience ?? 0.6,
    pinned: baseRecord.pinned,
  });
  return { ok: true, item: baseRecord };
}

export async function supersedeFoundationItem(id, replacement, options = {}){
  const confirmed = options.confirmed === true;
  const items = await readFoundationItems();
  const idx = items.findIndex((item) => item.id === id);
  if (idx === -1){
    return { ok: false, error: 'not_found' };
  }
  if (!confirmed){
    return { ok: false, confirmationRequired: true, proposal: { ...replacement, supersedesId: id } };
  }
  const existing = items[idx];
  const updated = { ...existing, supersededAt: nowTs() };
  items[idx] = updated;
  await writeFoundationItems(items);
  await recordWitness({ layer: 'foundation', op: 'supersede', payloadHash: existing.hash, prevHash: existing.hash });
  if (replacement){
    await appendFoundationItem({ ...replacement, supersedesId: id }, { confirmed: true });
  }
  await removeRecallEntriesFor('foundation', id);
  return { ok: true, item: updated };
}

export async function setFoundationPin(id, pinned){
  const items = await readFoundationItems();
  const idx = items.findIndex((item) => item.id === id);
  if (idx === -1) return { ok: false, error: 'not_found' };
  const updated = { ...items[idx], pinned: !!pinned };
  items[idx] = updated;
  await writeFoundationItems(items);
  await upsertRecallEntry({
    layer: 'foundation',
    itemId: id,
    summary: updated.content,
    salience: 0.8,
    pinned: updated.pinned,
  });
  return { ok: true, item: updated };
}
