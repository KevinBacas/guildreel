import { mkdir, readFile, rename, writeFile } from 'node:fs/promises';
import path from 'node:path';
import type { Clip, ReviewState } from './types.js';

export const ROOT = process.cwd();
export const DATA = path.join(ROOT, 'data');
export const DOWNLOADS = path.join(ROOT, 'downloads');
export const OUTPUT = path.join(ROOT, 'output');
export const CACHE = path.join(ROOT, 'cache');
export const YEAR = Number(process.env.DISCORD_YEAR || 2025);
export const CLIPS_FILE = path.join(DATA, 'clips.json');
export const REVIEW_FILE = path.join(DATA, 'review.json');

export async function ensureDirs() {
  await Promise.all([DATA, DOWNLOADS, OUTPUT, CACHE].map((dir) => mkdir(dir, { recursive: true })));
}

async function readJson<T>(file: string, fallback: T): Promise<T> {
  try { return JSON.parse(await readFile(file, 'utf8')) as T; }
  catch (error) { if ((error as NodeJS.ErrnoException).code === 'ENOENT') return fallback; throw error; }
}

async function atomicJson(file: string, value: unknown) {
  const temp = `${file}.${process.pid}.tmp`;
  await writeFile(temp, `${JSON.stringify(value, null, 2)}\n`);
  await rename(temp, file);
}

export async function loadClips(): Promise<Clip[]> { return readJson(CLIPS_FILE, []); }
let clipsWriteQueue: Promise<void> = Promise.resolve();
export async function saveClips(clips: Clip[]) {
  await ensureDirs();
  const snapshot = JSON.stringify(clips, null, 2) + '\n';
  clipsWriteQueue = clipsWriteQueue.then(async () => {
    const temp = `${CLIPS_FILE}.${process.pid}.tmp`;
    await writeFile(temp, snapshot);
    await rename(temp, CLIPS_FILE);
  });
  await clipsWriteQueue;
}
export async function loadReview(): Promise<ReviewState> {
  const state = await readJson<ReviewState>(REVIEW_FILE, { order: [], selected: [], scoreOverrides: {}, sortMode: 'score', initialized: false, updatedAt: new Date().toISOString() });
  return { ...state, sortMode: state.sortMode || 'score' };
}
export async function saveReview(state: ReviewState) { await atomicJson(REVIEW_FILE, { ...state, updatedAt: new Date().toISOString() }); }

export async function writeClipsCsv(clips: Clip[], file = path.join(DATA, 'clips.csv')) {
  const columns = ['rank', 'id', 'title', 'uploader', 'discordPoster', 'uploadDate', 'duration', 'viewCount', 'likeCount', 'commentCount', 'discordReactions', 'discordReactionBreakdown', 'discordOccurrences', 'score', 'url', 'originalVideoUrl', 'thumbnail', 'downloadStatus', 'downloadPath', 'messageUrl', 'postedAt'];
  const quote = (value: unknown) => `"${String(value ?? '').replaceAll('"', '""')}"`;
  const rows = clips.map((clip, index) => {
    const breakdown: Record<string, number> = {};
    for (const occurrence of clip.occurrences) for (const [emoji, count] of Object.entries(occurrence.reactions)) breakdown[emoji] = (breakdown[emoji] || 0) + count;
    return [index + 1, clip.id, clip.title, clip.uploader, clip.occurrences[0]?.author, clip.uploadDate, clip.duration, clip.viewCount, clip.likeCount, clip.commentCount, clip.discordReactions, JSON.stringify(breakdown), JSON.stringify(clip.occurrences), clip.score, clip.url, clip.originalVideoUrl, clip.thumbnail, clip.downloadStatus, clip.downloadPath, clip.occurrences[0]?.messageUrl, clip.occurrences[0]?.postedAt];
  });
  await writeFile(file, [columns.join(','), ...rows.map((row) => row.map(quote).join(','))].join('\n') + '\n');
}
