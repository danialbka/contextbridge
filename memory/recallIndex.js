/* global chrome */
import { RECALL_INDEX_STORAGE_KEY, RECALL_SCORE_WEIGHTS, RECALL_HALF_LIFE_DAYS } from './constants.js';
import { cosineSimilarity, daysBetween, nowTs, tokenize, uniqueId } from './utils.js';

async function readRecallIndex(){
  const { [RECALL_INDEX_STORAGE_KEY]: entries } = await chrome.storage.local.get(RECALL_INDEX_STORAGE_KEY);
  if (!Array.isArray(entries)) return [];
  return entries.map((entry) => ({ ...entry }));
}

async function writeRecallIndex(entries){
  await chrome.storage.local.set({ [RECALL_INDEX_STORAGE_KEY]: entries });
}

function deriveKeywords(summary, extra = []){
  const set = new Set([...(Array.isArray(extra) ? extra : []), ...tokenize(summary)]);
  return Array.from(set);
}

function recencyBoost(entry, now){
  const last = entry.lastUsedAt || entry.createdAt || 0;
  if (!last) return 0;
  const ageDays = daysBetween(now, last);
  const lambda = Math.exp(-ageDays / RECALL_HALF_LIFE_DAYS);
  return Math.min(1, Math.max(0, lambda));
}

function pinBoost(entry){
  return entry.pinned ? 1 : 0;
}

function semanticSimilarity(entry, query){
  if (query.embedding && entry.embedding && Array.isArray(entry.embedding)){
    return Math.max(0, cosineSimilarity(entry.embedding, query.embedding));
  }
  if (query.terms && entry.keywords){
    const keywords = new Set(entry.keywords);
    if (!keywords.size) return 0;
    let overlap = 0;
    query.terms.forEach((term) => {
      if (keywords.has(term)) overlap += 1;
    });
    return overlap / Math.sqrt(Math.max(query.terms.length, 1) * keywords.size);
  }
  return 0;
}

function scoreEntry(entry, query, now){
  const weights = RECALL_SCORE_WEIGHTS;
  const semantic = semanticSimilarity(entry, query);
  const recency = recencyBoost(entry, now);
  const salience = Number(entry.salience) || 0;
  const pin = pinBoost(entry);
  return (
    weights.semantic * semantic +
    weights.recency * recency +
    weights.salience * salience +
    weights.pin * pin
  );
}

export async function upsertRecallEntry({
  id,
  layer,
  itemId,
  summary,
  embedding,
  keywords,
  salience = 0.2,
  pinned = false,
}){
  const now = nowTs();
  const all = await readRecallIndex();
  const existingIdx = typeof id === 'string'
    ? all.findIndex((entry) => entry.id === id)
    : all.findIndex((entry) => entry.layer === layer && entry.itemId === itemId);
  const existingEntry = existingIdx === -1 ? null : all[existingIdx];
  let nextEmbedding;
  if (Array.isArray(embedding)){
    nextEmbedding = embedding.slice();
  } else if (embedding === null){
    nextEmbedding = null;
  } else if (existingEntry){
    nextEmbedding = Array.isArray(existingEntry.embedding)
      ? existingEntry.embedding.slice()
      : existingEntry.embedding ?? null;
  } else {
    nextEmbedding = null;
  }
  const entryId = id || uniqueId('recall');
  const entry = {
    id: entryId,
    layer,
    itemId,
    summary,
    embedding: nextEmbedding,
    keywords: deriveKeywords(summary, keywords),
    salience,
    createdAt: existingIdx === -1 ? now : existingEntry.createdAt,
    lastUsedAt: existingIdx === -1 ? 0 : existingEntry.lastUsedAt,
    pinned,
  };
  if (existingIdx === -1){
    all.push(entry);
  } else {
    all[existingIdx] = { ...all[existingIdx], ...entry };
  }
  await writeRecallIndex(all);
  return entry;
}

export async function removeRecallEntriesFor(layer, itemId){
  const all = await readRecallIndex();
  const filtered = all.filter((entry) => !(entry.layer === layer && entry.itemId === itemId));
  await writeRecallIndex(filtered);
}

export async function searchRecallIndex(query, limit = 24){
  const all = await readRecallIndex();
  const now = nowTs();
  const scored = all
    .map((entry) => ({ entry, score: scoreEntry(entry, query, now) }))
    .filter(({ score }) => score > 0)
    .sort((a, b) => b.score - a.score)
    .slice(0, limit)
    .map(({ entry, score }) => ({ ...entry, score }));
  return scored;
}

export async function markRecallUsage(entries){
  const ids = new Set(entries.map((entry) => entry.id));
  if (!ids.size) return;
  const all = await readRecallIndex();
  let dirty = false;
  const now = nowTs();
  const updated = all.map((entry) => {
    if (!ids.has(entry.id)) return entry;
    dirty = true;
    return { ...entry, lastUsedAt: now };
  });
  if (dirty){
    await writeRecallIndex(updated);
  }
}

export async function setRecallPin(layer, itemId, pinned){
  const all = await readRecallIndex();
  let dirty = false;
  const updated = all.map((entry) => {
    if (entry.layer === layer && entry.itemId === itemId){
      dirty = true;
      return { ...entry, pinned: !!pinned };
    }
    return entry;
  });
  if (dirty){
    await writeRecallIndex(updated);
  }
}

export async function clearRecallIndex(){
  await writeRecallIndex([]);
}
