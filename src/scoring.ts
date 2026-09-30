import { readFile } from 'node:fs/promises';
import path from 'node:path';
import type { Clip } from './types.js';
import { ROOT } from './store.js';

export async function scoreClip(clip: Clip): Promise<number> {
  const config = JSON.parse(await readFile(path.join(ROOT, 'config/scoring.json'), 'utf8')) as { terms: Array<{ field: keyof Clip; transform: 'linear' | 'log10_plus_one'; weight: number }> };
  return config.terms.reduce((total, term) => {
    const value = typeof clip[term.field] === 'number' ? clip[term.field] as number : 0;
    const transformed = term.transform === 'log10_plus_one' ? Math.log10(value + 1) : value;
    return total + transformed * term.weight;
  }, 0);
}

export async function updateScores(clips: Clip[]) {
  for (const clip of clips) clip.score = await scoreClip(clip);
}
