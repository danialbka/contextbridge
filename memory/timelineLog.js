/* global chrome */
import { TIMELINE_STORAGE_KEY, TIMELINE_TTL_DAYS } from './constants.js';
import { nowTs, uniqueId, normalizeText, tokenize } from './utils.js';
import { recordWitness } from './auditTrail.js';
import { upsertRecallEntry } from './recallIndex.js';

async function readTimeline(){
  const { [TIMELINE_STORAGE_KEY]: events } = await chrome.storage.local.get(TIMELINE_STORAGE_KEY);
  if (!Array.isArray(events)) return [];
  return events.map((event) => ({ ...event }));
}

async function writeTimeline(events){
  await chrome.storage.local.set({ [TIMELINE_STORAGE_KEY]: events });
}

function withinTtl(event, now){
  if (!event?.ts) return true;
  const ageMs = now - event.ts;
  const ttlMs = TIMELINE_TTL_DAYS * 24 * 60 * 60 * 1000;
  return ageMs <= ttlMs;
}

function summarizeEvent(event){
  if (event.summary) return event.summary;
  const base = normalizeText(event.text || '');
  if (base) return base;
  if (event.meta?.url) return `Visited ${event.meta.url}`;
  return `${event.channel || 'event'} recorded`;
}

export async function appendTimelineEvent(data = {}, options = {}){
  const now = nowTs();
  const events = await readTimeline();
  const id = data.id || uniqueId('timeline');
  const record = {
    id,
    ts: data.ts || now,
    actor: data.actor || 'agent',
    channel: data.channel || 'chat',
    text: normalizeText(data.text),
    meta: data.meta ? { ...data.meta } : {},
    embedding: Array.isArray(data.embedding) ? data.embedding.slice() : null,
    summary: summarizeEvent(data),
    salience: Number.isFinite(data.salience) ? data.salience : 0.2,
    pinned: !!data.pinned,
  };
  const filtered = events.filter((event) => withinTtl(event, now));
  filtered.push(record);
  await writeTimeline(filtered);
  await recordWitness({ layer: 'timeline', op: data.id ? 'update' : 'append', payloadHash: await hashTimeline(record) });
  await upsertRecallEntry({
    layer: 'timeline',
    itemId: record.id,
    summary: record.summary,
    embedding: record.embedding,
    salience: record.salience,
    keywords: tokenize(record.summary),
    pinned: record.pinned,
  });
  return record;
}

async function hashTimeline(event){
  const payload = JSON.stringify({
    id: event.id,
    ts: event.ts,
    actor: event.actor,
    channel: event.channel,
    summary: event.summary,
  });
  const encoder = new TextEncoder();
  const data = encoder.encode(payload);
  if (crypto?.subtle?.digest){
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    return Array.from(new Uint8Array(hashBuffer)).map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  let hash = 0;
  for (let i = 0; i < data.length; i += 1){
    hash = (hash * 31 + data[i]) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export async function getTimelineEventsByIds(ids){
  const set = new Set(ids);
  if (!set.size) return [];
  const events = await readTimeline();
  return events.filter((event) => set.has(event.id));
}

export async function getRecentTimelineEvents(limit = 5){
  const events = await readTimeline();
  return events
    .sort((a, b) => (b.ts || 0) - (a.ts || 0))
    .slice(0, limit);
}

export async function setTimelinePin(id, pinned){
  const events = await readTimeline();
  const idx = events.findIndex((event) => event.id === id);
  if (idx === -1) return { ok: false, error: 'not_found' };
  const updated = { ...events[idx], pinned: !!pinned };
  events[idx] = updated;
  await writeTimeline(events);
  await upsertRecallEntry({
    layer: 'timeline',
    itemId: id,
    summary: updated.summary,
    salience: updated.salience,
    pinned: updated.pinned,
  });
  return { ok: true, item: updated };
}
