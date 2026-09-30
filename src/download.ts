import 'dotenv/config';
import { spawn } from 'node:child_process';
import { readdir } from 'node:fs/promises';
import path from 'node:path';
import { DOWNLOADS, ensureDirs, loadClips, saveClips, writeClipsCsv } from './store.js';

function run(args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(process.env.YT_DLP_PATH || 'yt-dlp', args, { stdio: 'inherit' });
    child.on('error', (error) => reject(new Error(`Could not start yt-dlp: ${error.message}`)));
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(`yt-dlp exited with code ${code}`)));
  });
}

function findDownloaded(files: string[], id: string) { return files.find((file) => file.startsWith(`${id}.`) && !file.endsWith('.part') && !file.endsWith('.ytdl')); }

export async function downloadClips() {
  await ensureDirs();
  const clips = await loadClips();
  const knownFiles = await readdir(DOWNLOADS);
  const candidates = clips.filter((clip) => clip.downloadStatus !== 'downloaded' || !findDownloaded(knownFiles, clip.id));
  const requestedConcurrency = Number(process.env.DOWNLOAD_CONCURRENCY) || 2;
  const concurrency = Math.max(1, Math.min(4, requestedConcurrency));
  let cursor = 0;
  let success = 0;
  const worker = async () => {
    while (cursor < candidates.length) {
      const clip = candidates[cursor++];
      let files = await readdir(DOWNLOADS);
      const existing = clip.downloadPath && files.includes(path.basename(clip.downloadPath)) ? path.basename(clip.downloadPath) : findDownloaded(files, clip.id);
      if (existing) {
        clip.downloadPath = path.join('downloads', existing); clip.downloadStatus = 'downloaded'; delete clip.downloadError;
        success++; await saveClips(clips); continue;
      }
      console.log(`[download ${success + 1}/${candidates.length}] ${clip.id} ${clip.url}`);
      let lastError: Error | undefined;
      for (let attempt = 1; attempt <= 3; attempt++) {
        try {
          await run(['--no-warnings', '--no-playlist', '--retries', '3', '--fragment-retries', '3', '--file-access-retries', '2', '-f', 'bv*+ba/b', '--merge-output-format', 'mp4', '-o', path.join(DOWNLOADS, `${clip.id}.%(ext)s`), clip.url]);
          files = await readdir(DOWNLOADS);
          const result = findDownloaded(files, clip.id);
          if (!result) throw new Error('yt-dlp completed but no output file was found.');
          clip.downloadPath = path.join('downloads', result); clip.downloadStatus = 'downloaded'; delete clip.downloadError;
          lastError = undefined; success++; break;
        } catch (error) {
          lastError = error as Error;
          if (attempt < 3) await new Promise((resolve) => setTimeout(resolve, attempt * 1500));
        }
      }
      if (lastError) { clip.downloadStatus = 'failed'; clip.downloadError = lastError.message.slice(0, 1200); console.error(`  failed: ${clip.downloadError}`); }
      clip.updatedAt = new Date().toISOString();
      await saveClips(clips);
    }
  };
  await Promise.all(Array.from({ length: Math.min(concurrency, Math.max(1, candidates.length)) }, worker));
  await writeClipsCsv(clips);
  console.log(`Downloads complete: ${success} available, ${clips.filter((clip) => clip.downloadStatus === 'failed').length} failed, ${clips.filter((clip) => clip.downloadStatus === 'pending').length} pending.`);
}
