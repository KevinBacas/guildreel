import type { Clip, ReviewSort } from './types.js';

function stableHash(value: string) {
  let hash = 2166136261;
  for (let i = 0; i < value.length; i++) hash = Math.imul(hash ^ value.charCodeAt(i), 16777619);
  return hash >>> 0;
}

function timestamp(clip: Clip) {
  const medalDate = clip.uploadDate;
  if (medalDate && /^\d{8}$/.test(medalDate)) {
    return Date.UTC(Number(medalDate.slice(0, 4)), Number(medalDate.slice(4, 6)) - 1, Number(medalDate.slice(6, 8)));
  }
  const parsed = medalDate ? Date.parse(medalDate) : NaN;
  if (Number.isFinite(parsed)) return parsed;
  const postedAt = clip.occurrences[0]?.postedAt;
  return postedAt ? Date.parse(postedAt) || 0 : 0;
}

export function orderClips(clips: Clip[], mode: ReviewSort, scoreOverrides: Record<string, number>, savedOrder: string[]) {
  const tieOrder = new Map(savedOrder.map((id, index) => [id, index]));
  const fallbackOrder = (a: Clip, b: Clip) => (tieOrder.get(a.id) ?? Number.MAX_SAFE_INTEGER) - (tieOrder.get(b.id) ?? Number.MAX_SAFE_INTEGER);
  if (mode === 'manual') return [...clips].sort(fallbackOrder);
  if (mode === 'random') return [...clips].sort((a, b) => stableHash(a.id) - stableHash(b.id) || fallbackOrder(a, b));

  const metric = (clip: Clip) => {
    if (mode === 'score') return scoreOverrides[clip.id] ?? clip.score;
    if (mode === 'views') return clip.viewCount ?? 0;
    if (mode === 'likes') return clip.likeCount ?? 0;
    if (mode === 'reactions') return clip.discordReactions;
    return timestamp(clip);
  };
  const direction = mode === 'chrono' ? 1 : -1;
  return [...clips].sort((a, b) => direction * (metric(a) - metric(b)) || fallbackOrder(a, b));
}
