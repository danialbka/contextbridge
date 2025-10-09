/* global chrome */
import { SIGNALS_STORAGE_KEY, SIGNAL_EDGES_STORAGE_KEY } from './constants.js';
import { uniqueId, normalizeText, tokenize } from './utils.js';
import { recordWitness } from './auditTrail.js';
import { upsertRecallEntry } from './recallIndex.js';

async function readSignals(){
  const { [SIGNALS_STORAGE_KEY]: items } = await chrome.storage.local.get(SIGNALS_STORAGE_KEY);
  return Array.isArray(items) ? items.map((item) => ({ ...item })) : [];
}

async function writeSignals(items){
  await chrome.storage.local.set({ [SIGNALS_STORAGE_KEY]: items });
}

async function readEdges(){
  const { [SIGNAL_EDGES_STORAGE_KEY]: edges } = await chrome.storage.local.get(SIGNAL_EDGES_STORAGE_KEY);
  return Array.isArray(edges) ? edges.map((edge) => ({ ...edge })) : [];
}

async function writeEdges(edges){
  await chrome.storage.local.set({ [SIGNAL_EDGES_STORAGE_KEY]: edges });
}

export async function appendSignal(data){
  const items = await readSignals();
  const id = data.id || uniqueId('signal');
  const record = {
    id,
    modality: data.modality || 'text',
    uri: data.uri || null,
    caption: normalizeText(data.caption),
    embedding: Array.isArray(data.embedding) ? data.embedding.slice() : null,
    meta: data.meta ? { ...data.meta } : {},
    createdAt: Date.now(),
    salience: Number.isFinite(data.salience) ? data.salience : 0.3,
    pinned: !!data.pinned,
  };
  items.push(record);
  await writeSignals(items);
  await recordWitness({ layer: 'signals', op: 'append', payloadHash: record.id });
  await upsertRecallEntry({
    layer: 'signals',
    itemId: record.id,
    summary: record.caption || record.uri || record.modality,
    embedding: record.embedding,
    salience: record.salience,
    keywords: tokenize(record.caption || ''),
    pinned: record.pinned,
  });
  return record;
}

export async function linkSignals(fromId, toId, relation = 'related', weight = 0.5){
  if (!fromId || !toId) return null;
  const edges = await readEdges();
  const id = uniqueId('edge');
  const edge = { id, fromId, toId, relation, weight, createdAt: Date.now() };
  edges.push(edge);
  await writeEdges(edges);
  await recordWitness({ layer: 'signals_edges', op: 'append', payloadHash: id });
  return edge;
}

export async function getSignalsByIds(ids){
  const set = new Set(ids);
  if (!set.size) return [];
  const items = await readSignals();
  return items.filter((item) => set.has(item.id));
}

export async function expandEvidenceFromHits(hits, limit = 4){
  const edges = await readEdges();
  const ids = new Set(hits.map((hit) => hit.itemId));
  const related = edges.filter((edge) => ids.has(edge.fromId) || ids.has(edge.toId));
  const targetIds = new Set();
  for (const edge of related){
    if (ids.has(edge.fromId)) targetIds.add(edge.toId);
    if (ids.has(edge.toId)) targetIds.add(edge.fromId);
  }
  const items = await getSignalsByIds(Array.from(targetIds).slice(0, limit));
  return items.map((item) => ({
    ...item,
    relation: related.find((edge) => edge.fromId === item.id || edge.toId === item.id)?.relation || 'related',
  }));
}
