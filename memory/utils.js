const encoder = new TextEncoder();

export async function hashText(text){
  const data = encoder.encode(String(text || ''));
  if (crypto?.subtle?.digest){
    const hashBuffer = await crypto.subtle.digest('SHA-256', data);
    const hashArray = Array.from(new Uint8Array(hashBuffer));
    return hashArray.map((b) => b.toString(16).padStart(2, '0')).join('');
  }
  // Fallback non-cryptographic hash (not ideal but keeps flow working)
  let hash = 0;
  for (let i = 0; i < data.length; i += 1){
    hash = (hash * 31 + data[i]) >>> 0;
  }
  return hash.toString(16).padStart(8, '0');
}

export function nowTs(){
  return Date.now();
}

export function clampNumber(value, min, max){
  const n = Number(value);
  if (!Number.isFinite(n)) return min;
  if (typeof min === 'number' && n < min) return min;
  if (typeof max === 'number' && n > max) return max;
  return n;
}

export function uniqueId(prefix = 'mem'){
  return `${prefix}_${crypto?.randomUUID ? crypto.randomUUID() : Math.random().toString(36).slice(2)}`;
}

export function normalizeText(text){
  return String(text || '')
    .replace(/\s+/g, ' ')
    .trim();
}

export function tokenize(text){
  return normalizeText(text)
    .toLowerCase()
    .split(/[^a-z0-9]+/)
    .filter(Boolean);
}

export function dedupeById(items){
  const map = new Map();
  items.forEach((item) => {
    if (item && item.id && !map.has(item.id)){
      map.set(item.id, item);
    }
  });
  return Array.from(map.values());
}

export function cosineSimilarity(vecA = [], vecB = []){
  if (!Array.isArray(vecA) || !Array.isArray(vecB)) return 0;
  if (!vecA.length || vecA.length !== vecB.length) return 0;
  let dot = 0;
  let magA = 0;
  let magB = 0;
  for (let i = 0; i < vecA.length; i += 1){
    const a = Number(vecA[i]) || 0;
    const b = Number(vecB[i]) || 0;
    dot += a * b;
    magA += a * a;
    magB += b * b;
  }
  if (!magA || !magB) return 0;
  return dot / (Math.sqrt(magA) * Math.sqrt(magB));
}

export function daysBetween(tsA, tsB){
  return Math.abs((Number(tsA) - Number(tsB)) / (1000 * 60 * 60 * 24));
}

export function ensureArray(value){
  if (Array.isArray(value)) return value;
  if (value === undefined || value === null) return [];
  return [value];
}

export function byDescending(field, fallback = 0){
  return (a, b) => (Number(b?.[field]) || fallback) - (Number(a?.[field]) || fallback);
}
