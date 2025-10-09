/* global chrome */
import { AUDIT_STORAGE_KEY } from './constants.js';
import { hashText, nowTs, uniqueId } from './utils.js';

async function readAudit(){
  const { [AUDIT_STORAGE_KEY]: entries } = await chrome.storage.local.get(AUDIT_STORAGE_KEY);
  return Array.isArray(entries) ? entries.map((entry) => ({ ...entry })) : [];
}

async function writeAudit(entries){
  await chrome.storage.local.set({ [AUDIT_STORAGE_KEY]: entries });
}

export async function recordWitness({ layer, op, payloadHash, prevHash }){
  const entries = await readAudit();
  const last = entries[entries.length - 1];
  const linkHash = prevHash || last?.hash || null;
  const ts = nowTs();
  const id = uniqueId('witness');
  const hash = await hashText(`${layer}:${op}:${payloadHash}:${linkHash}:${ts}`);
  const entry = { id, ts, layer, op, payloadHash, prevHash: linkHash, hash };
  entries.push(entry);
  await writeAudit(entries);
  return entry;
}

export async function exportAuditTrail(){
  const entries = await readAudit();
  return entries.sort((a, b) => (a.ts || 0) - (b.ts || 0));
}

export async function clearAuditTrail(){
  await writeAudit([]);
}
