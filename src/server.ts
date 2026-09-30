import 'dotenv/config';
import express from 'express';
import path from 'node:path';
import { spawn, type ChildProcess } from 'node:child_process';
import { access } from 'node:fs/promises';
import { createServer as createViteServer } from 'vite';
import { DOWNLOADS, ROOT, YEAR, loadClips, loadReview, saveClips, saveReview } from './store.js';
import { writeClipsCsv } from './store.js';
import { updateScores } from './scoring.js';
import type { ReviewSort, ReviewState } from './types.js';

const REVIEW_SORTS: ReviewSort[] = ['manual', 'score', 'views', 'likes', 'reactions', 'chrono', 'random'];

let renderProcess: ChildProcess | undefined;
let renderOutput = '';

export async function startReviewServer() {
  const app = express();
  app.use(express.json({ limit: '2mb' }));
  app.get('/api/clips', async (_req, res) => {
    const clips = await loadClips();
    const review = await loadReview();
    const configuredLimit = Number(process.env.MAX_CLIPS_PER_UPLOADER ?? 5);
    const maxClipsPerUploader = Number.isFinite(configuredLimit) && configuredLimit >= 0 ? configuredLimit : 5;
    res.json({ year: YEAR, clips, review, maxClipsPerUploader });
  });
  app.get('/api/status', async (_req, res) => {
    const clips = await loadClips();
    res.json({ year: YEAR, total: clips.length, ready: clips.filter((clip) => clip.downloadStatus === 'downloaded').length, failed: clips.filter((clip) => clip.downloadStatus === 'failed').length });
  });
  app.put('/api/review', async (req, res) => {
    const input = req.body as Partial<ReviewState>;
    if (!Array.isArray(input.order) || !Array.isArray(input.selected) || typeof input.scoreOverrides !== 'object' || !input.scoreOverrides) return res.status(400).json({ error: 'Invalid review state.' });
    const known = new Set((await loadClips()).map((clip) => clip.id));
    const sortMode = REVIEW_SORTS.includes(input.sortMode as ReviewSort) ? input.sortMode as ReviewSort : 'score';
    const state: ReviewState = { order: [...new Set(input.order.filter((id): id is string => typeof id === 'string' && known.has(id)))], selected: [...new Set(input.selected.filter((id): id is string => typeof id === 'string' && known.has(id)))], scoreOverrides: Object.fromEntries(Object.entries(input.scoreOverrides).filter(([id, score]) => known.has(id) && typeof score === 'number' && Number.isFinite(score))), sortMode, initialized: true, updatedAt: new Date().toISOString() };
    await saveReview(state);
    res.json({ ok: true, updatedAt: state.updatedAt });
  });
  app.get('/media/:id', async (req, res) => {
    const clips = await loadClips();
    const clip = clips.find((item) => item.id === req.params.id);
    if (!clip?.downloadPath || clip.downloadStatus !== 'downloaded') return res.sendStatus(404);
    const file = path.resolve(ROOT, clip.downloadPath);
    if (!file.startsWith(`${DOWNLOADS}${path.sep}`)) return res.sendStatus(400);
    try { await access(file); res.sendFile(file); } catch { res.sendStatus(404); }
  });
  app.post('/api/export', async (_req, res) => {
    const clips = await loadClips(); await updateScores(clips); await saveClips(clips); await writeClipsCsv(clips);
    res.json({ ok: true });
  });
  app.post('/api/render', async (_req, res) => {
    if (renderProcess && renderProcess.exitCode === null) return res.status(409).json({ error: 'A render is already running.' });
    renderOutput = '';
    renderProcess = spawn(process.execPath, ['--import', 'tsx', 'src/cli.ts', 'render'], { cwd: ROOT, env: process.env, stdio: ['ignore', 'pipe', 'pipe'] });
    const collect = (chunk: Buffer) => { renderOutput = (renderOutput + chunk.toString()).slice(-10000); };
    renderProcess.stdout?.on('data', collect); renderProcess.stderr?.on('data', collect);
    renderProcess.on('error', (error) => { renderOutput += `\n${error.message}`; });
    return res.json({ started: true });
  });
  app.get('/api/render', (_req, res) => res.json({ running: Boolean(renderProcess && renderProcess.exitCode === null), exitCode: renderProcess?.exitCode ?? null, output: renderOutput }));
  const port = Number(process.env.PORT || 4173);
  const vite = await createViteServer({ configFile: path.join(ROOT, 'vite.config.ts'), server: { middlewareMode: true, hmr: false }, appType: 'spa' });
  app.use(vite.middlewares);
  const server = app.listen(port, '127.0.0.1', () => console.log(`Review UI ready at http://127.0.0.1:${port}`));
  const close = async () => { server.close(); await vite.close(); process.exit(0); };
  process.on('SIGINT', close); process.on('SIGTERM', close);
}
