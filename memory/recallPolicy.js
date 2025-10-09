import { MEMORY_DEFAULTS } from './constants.js';

function truncate(list, limit){
  if (!Array.isArray(list)) return [];
  return list.slice(0, limit);
}

export function applyRecallPolicy({
  foundation = [],
  timeline = [],
  signals = [],
}, options = {}){
  const limits = { ...MEMORY_DEFAULTS, ...(options.limits || {}) };
  const foundationItems = truncate(foundation, limits.foundationLimit);
  const timelineItems = truncate(timeline, limits.timelineLimit);
  const signalItems = truncate(signals, limits.signalsLimit);
  return {
    foundation: foundationItems,
    timeline: timelineItems,
    signals: signalItems,
  };
}

export function composeContextPack(policyOutput){
  return {
    foundation: policyOutput.foundation.map((item) => ({
      id: item.id,
      kind: item.kind,
      content: item.content,
      source: item.source,
      createdAt: item.createdAt,
      supersedesId: item.supersedesId,
      pinned: item.pinned,
    })),
    essentials: policyOutput.timeline.map((event) => ({
      id: event.id,
      summary: event.summary,
      ts: event.ts,
      actor: event.actor,
      channel: event.channel,
      meta: event.meta,
    })),
    episodes: policyOutput.timeline.map((event) => ({
      id: event.id,
      text: event.text,
      summary: event.summary,
      ts: event.ts,
      channel: event.channel,
    })),
    evidence: policyOutput.signals.map((signal) => ({
      id: signal.id,
      modality: signal.modality,
      uri: signal.uri,
      caption: signal.caption,
      relation: signal.relation,
    })),
  };
}
