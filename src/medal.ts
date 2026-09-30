import { spawn } from 'node:child_process';
import type { Clip } from './types.js';
import { loadClips, saveClips, writeClipsCsv } from './store.js';
import { updateScores } from './scoring.js';

function run(command: string, args: string[]): Promise<string> {
  return new Promise((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'pipe', 'pipe'] });
    let stdout = ''; let stderr = '';
    child.stdout.setEncoding('utf8').on('data', (chunk) => stdout += chunk);
    child.stderr.setEncoding('utf8').on('data', (chunk) => stderr += chunk);
    child.on('error', (error) => reject(new Error(`Could not start ${command}: ${error.message}`)));
    child.on('close', (code) => code === 0 ? resolve(stdout) : reject(new Error(stderr.trim() || `${command} exited with code ${code}`)));
  });
}

function numberOrUndefined(value: unknown): number | undefined { return typeof value === 'number' && Number.isFinite(value) ? value : undefined; }

export async function fetchMetadata() {
  const clips = await loadClips();
  let done = 0;
  for (const clip of clips) {
    if (clip.metadataStatus === 'ok') { done++; continue; }
    console.log(`[metadata ${done + 1}/${clips.length}] ${clip.id}`);
    try {
      const raw = JSON.parse(await run(process.env.YT_DLP_PATH || 'yt-dlp', ['--no-warnings', '--no-download', '--dump-single-json', clip.url])) as Record<string, unknown>;
      clip.title = typeof raw.title === 'string' ? raw.title : clip.title;
      clip.uploader = typeof raw.uploader === 'string' ? raw.uploader : typeof raw.channel === 'string' ? raw.channel : clip.uploader;
      clip.uploadDate = typeof raw.upload_date === 'string' ? raw.upload_date : clip.uploadDate;
      clip.duration = numberOrUndefined(raw.duration) ?? clip.duration;
      clip.viewCount = numberOrUndefined(raw.view_count) ?? clip.viewCount;
      clip.likeCount = numberOrUndefined(raw.like_count) ?? clip.likeCount;
      clip.commentCount = numberOrUndefined(raw.comment_count) ?? clip.commentCount;
      clip.thumbnail = typeof raw.thumbnail === 'string' ? raw.thumbnail : clip.thumbnail;
      clip.originalVideoUrl = typeof raw.url === 'string' ? raw.url : typeof raw.original_url === 'string' ? raw.original_url : typeof raw.webpage_url === 'string' ? raw.webpage_url : clip.url;
      clip.extractor = typeof raw.extractor_key === 'string' ? raw.extractor_key : typeof raw.extractor === 'string' ? raw.extractor : undefined;
      clip.metadataStatus = 'ok'; delete clip.metadataError;
    } catch (error) {
      clip.metadataStatus = 'failed'; clip.metadataError = (error as Error).message.slice(0, 1200);
      console.error(`  failed: ${clip.metadataError}`);
    }
    clip.updatedAt = new Date().toISOString();
    await updateScores(clips);
    await saveClips(clips);
    done++;
  }
  await updateScores(clips); await saveClips(clips);
  await writeClipsCsv(clips);
  console.log(`Metadata complete: ${clips.filter((clip) => clip.metadataStatus === 'ok').length} succeeded, ${clips.filter((clip) => clip.metadataStatus === 'failed').length} failed.`);
}
