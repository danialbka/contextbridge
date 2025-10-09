import { extractCues, buildQueries } from './cueMapper.js';
import { selectFoundationItems } from './foundationStore.js';
import { searchRecallIndex, markRecallUsage } from './recallIndex.js';
import { getTimelineEventsByIds } from './timelineLog.js';
import { expandEvidenceFromHits, getSignalsByIds } from './signalsStore.js';
import { applyRecallPolicy, composeContextPack } from './recallPolicy.js';

function mapHitsByLayer(hits){
  const buckets = { foundation: [], timeline: [], signals: [] };
  hits.forEach((hit) => {
    if (hit.layer === 'foundation') buckets.foundation.push(hit);
    if (hit.layer === 'timeline') buckets.timeline.push(hit);
    if (hit.layer === 'signals') buckets.signals.push(hit);
  });
  return buckets;
}

export async function retrieveMemoryContext(prompt, uiCtx = {}, options = {}){
  const cues = extractCues(prompt, uiCtx);
  const { semantic } = buildQueries(cues);
  const foundation = await selectFoundationItems(cues, options.foundationLimit);
  const hits = await searchRecallIndex(semantic, options.recallIndexLimit);
  const buckets = mapHitsByLayer(hits);
  const timelineIds = buckets.timeline.map((hit) => hit.itemId);
  const signalIds = buckets.signals.map((hit) => hit.itemId);
  const timelineEvents = await getTimelineEventsByIds(timelineIds);
  const directSignals = await getSignalsByIds(signalIds);
  const expandedSignals = await expandEvidenceFromHits(buckets.timeline.concat(buckets.signals), options.signalsLimit);
  const signals = [...directSignals, ...expandedSignals];
  const policyOutput = applyRecallPolicy({ foundation, timeline: timelineEvents, signals }, { limits: options });
  const contextPack = composeContextPack(policyOutput);
  await markRecallUsage(hits);
  return { cues, context: contextPack };
}
