export const FOUNDATION_STORAGE_KEY = 'memory_foundation_v1';
export const RECALL_INDEX_STORAGE_KEY = 'memory_recall_index_v1';
export const TIMELINE_STORAGE_KEY = 'memory_timeline_v1';
export const SIGNALS_STORAGE_KEY = 'memory_signals_v1';
export const SIGNAL_EDGES_STORAGE_KEY = 'memory_signal_edges_v1';
export const AUDIT_STORAGE_KEY = 'memory_audit_v1';

export const MEMORY_DEFAULTS = {
  recallIndexLimit: 24,
  foundationLimit: 3,
  timelineLimit: 5,
  signalsLimit: 4,
};

export const TIMELINE_TTL_DAYS = 90;

export const RECALL_SCORE_WEIGHTS = {
  semantic: 0.55,
  recency: 0.20,
  salience: 0.15,
  pin: 0.10,
};

export const RECALL_HALF_LIFE_DAYS = 14;
