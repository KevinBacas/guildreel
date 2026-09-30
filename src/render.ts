import 'dotenv/config';
import { spawn } from 'node:child_process';
import { createHash } from 'node:crypto';
import { access, stat, writeFile } from 'node:fs/promises';
import path from 'node:path';
import { Resvg } from '@resvg/resvg-js';
import { CACHE, OUTPUT, ensureDirs, loadClips, loadReview, saveClips, writeClipsCsv, YEAR } from './store.js';
import { orderClips } from './order.js';
import type { Clip } from './types.js';

const ffmpeg = process.env.FFMPEG_PATH || 'ffmpeg';
const ffprobe = process.env.FFPROBE_PATH || 'ffprobe';

function run(command: string, args: string[]) {
  return new Promise<void>((resolve, reject) => {
    const child = spawn(command, args, { stdio: ['ignore', 'ignore', 'pipe'] });
    let stderr = '';
    child.stderr.setEncoding('utf8').on('data', (chunk) => stderr += chunk);
    child.on('error', (error) => reject(new Error(`Could not start ${command}: ${error.message}`)));
    child.on('close', (code) => code === 0 ? resolve() : reject(new Error(stderr.trim().slice(-2500) || `${command} exited with code ${code}`)));
  });
}

function formatDuration(seconds: number) {
  const rounded = Math.max(0, Math.round(seconds));
  return `${Math.floor(rounded / 60)}:${String(rounded % 60).padStart(2, '0')}`;
}

function xmlEscape(value: string) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function popupDate(clip: Clip) {
  const upload = clip.uploadDate || '';
  let date: Date | undefined;
  if (/^\d{8}$/.test(upload)) {
    date = new Date(Date.UTC(Number(upload.slice(0, 4)), Number(upload.slice(4, 6)) - 1, Number(upload.slice(6, 8))));
  } else if (upload) {
    const parsed = new Date(upload);
    if (Number.isFinite(parsed.getTime())) date = parsed;
  }
  if (!date && clip.occurrences[0]?.postedAt) date = new Date(clip.occurrences[0].postedAt);
  return date && Number.isFinite(date.getTime())
    ? new Intl.DateTimeFormat('fr-FR', { day: 'numeric', month: 'long', year: 'numeric', timeZone: 'UTC' }).format(date)
    : 'Date inconnue';
}

function wrapTitle(value: string) {
  const words = (value || 'Clip Medal').trim().split(/\s+/);
  const lines: string[] = [];
  let line = '';
  for (const word of words) {
    const part = word.length > 43 ? `${word.slice(0, 40)}…` : word;
    if (line && `${line} ${part}`.length > 43) {
      lines.push(line);
      line = part;
    } else line = line ? `${line} ${part}` : part;
    if (lines.length === 2) break;
  }
  if (line && lines.length < 2) lines.push(line);
  const used = lines.join(' ').length;
  if (words.join(' ').length > used && lines.length) lines[lines.length - 1] = `${lines.at(-1)!.slice(0, 39)}…`;
  return lines.length ? lines : ['Clip Medal'];
}

export function popupSvg(clip: Clip, date: string) {
  const lines = wrapTitle(clip.title || 'Clip Medal');
  const firstBaseline = lines.length > 1 ? 907 : 934;
  const title = lines.map((line, index) => `<text x="100" y="${firstBaseline + index * 41}" fill="#f8faf5" font-family="Arial, sans-serif" font-size="34" font-weight="700">${xmlEscape(line)}</text>`).join('\n');
  return `<svg xmlns="http://www.w3.org/2000/svg" width="1920" height="1080" viewBox="0 0 1920 1080">
    <defs>
      <linearGradient id="panel" x1="0" y1="0" x2="1" y2="0">
        <stop offset="0" stop-color="#0b1114" stop-opacity="0.94"/>
        <stop offset="1" stop-color="#17211f" stop-opacity="0.86"/>
      </linearGradient>
      <linearGradient id="accent" x1="0" y1="0" x2="0" y2="1">
        <stop offset="0" stop-color="#ecffac"/>
        <stop offset="1" stop-color="#a8d36d"/>
      </linearGradient>
    </defs>
    <rect x="58" y="822" width="1100" height="205" rx="20" fill="url(#panel)"/>
    <rect x="58" y="822" width="1100" height="205" rx="20" fill="none" stroke="#e8f6d5" stroke-opacity="0.28" stroke-width="2"/>
    <rect x="58" y="822" width="7" height="205" rx="3" fill="url(#accent)"/>
    <circle cx="101" cy="856" r="5" fill="#dbf285"/>
    <text x="117" y="861" fill="#dbf285" font-family="Arial, sans-serif" font-size="16" font-weight="700" letter-spacing="3">AFTERPLAY / MOMENT</text>
    <text x="1113" y="861" text-anchor="end" fill="#a5b3ac" font-family="Arial, sans-serif" font-size="15" font-weight="700" letter-spacing="2">BEST OF ${YEAR}</text>
    ${title}
    <line x1="100" y1="972" x2="1113" y2="972" stroke="#c8d5c6" stroke-opacity="0.26"/>
    <text x="100" y="1000" fill="#c5d3c9" font-family="Arial, sans-serif" font-size="18" font-weight="500">${xmlEscape(date)}</text>
    <circle cx="1098" cy="993" r="9" fill="none" stroke="#dbf285" stroke-width="2"/>
    <path d="M1095 989 L1101 993 L1095 997 Z" fill="#dbf285"/>
  </svg>`;
}

async function writeSvgPng(name: string, svg: string) {
  const file = path.join(CACHE, name);
  const png = new Resvg(svg, { fitTo: { mode: 'original' } }).render().asPng();
  await writeFile(file, png);
  return file;
}

async function hasAudio(file: string) {
  const child = spawn(ffprobe, ['-v', 'error', '-select_streams', 'a:0', '-show_entries', 'stream=codec_type', '-of', 'csv=p=0', file], { stdio: ['ignore', 'pipe', 'ignore'] });
  let output = '';
  child.stdout.setEncoding('utf8').on('data', (chunk) => output += chunk);
  return new Promise<boolean>((resolve, reject) => {
    child.on('error', reject);
    child.on('close', (code) => code === 0 ? resolve(output.trim().length > 0) : reject(new Error(`ffprobe could not inspect ${file}`)));
  });
}

export async function renderMontage() {
  await ensureDirs();
  const clips = await loadClips();
  const state = await loadReview();
  const selected = new Set(state.selected);
  const inSavedOrder = state.order
    .map((id) => clips.find((clip) => clip.id === id))
    .filter((clip): clip is Clip => Boolean(clip && selected.has(clip.id)));
  const ordered = orderClips(inSavedOrder, state.sortMode, state.scoreOverrides, state.order);
  const downloadable = ordered.filter((clip) => clip.downloadPath && clip.downloadStatus === 'downloaded');
  if (!downloadable.length) throw new Error('No selected clips have been downloaded. Run npm run download and select clips in the review page.');
  if (downloadable.length < ordered.length) console.warn(`Skipping ${ordered.length - downloadable.length} selected clip(s) without a completed local download.`);

  const segments: string[] = [];
  const renderedClips: Clip[] = [];
  for (const [index, clip] of downloadable.entries()) {
    const source = path.join(process.cwd(), clip.downloadPath!);
    try {
      await access(source);
    } catch {
      clip.downloadStatus = 'failed';
      clip.downloadError = 'Downloaded file is missing.';
      continue;
    }

    const info = await stat(source);
    const date = popupDate(clip);
    const title = clip.title || 'Clip Medal';
    const key = createHash('sha256').update(JSON.stringify({
      version: 4,
      source,
      size: info.size,
      mtime: info.mtimeMs,
      title,
      date,
      preset: process.env.RENDER_PRESET || 'medium',
      crf: process.env.RENDER_CRF || '18',
    })).digest('hex').slice(0, 18);
    const segment = path.join(CACHE, `segment-${clip.id}-${key}.mp4`);
    try {
      await access(segment);
    } catch {
      console.log(`[render ${index + 1}/${downloadable.length}] Normalizing ${clip.id}`);
      const popupFile = await writeSvgPng(`popup-${clip.id}-${key}.png`, popupSvg(clip, date));
      const videoFilters = [
        'scale=1920:1080:force_original_aspect_ratio=decrease',
        'pad=1920:1080:(ow-iw)/2:(oh-ih)/2:color=black',
        'setsar=1',
        'fps=60',
        'format=yuv420p',
      ];
      const args = ['-y', '-i', source, '-loop', '1', '-framerate', '60', '-i', popupFile];
      const audioPresent = await hasAudio(source);
      if (!audioPresent) args.push('-f', 'lavfi', '-i', 'anullsrc=r=48000:cl=stereo');
      const filterGraph = `[0:v]${videoFilters.join(',')}[base];[1:v]format=rgba[popup];[base][popup]overlay=0:0:enable='lt(t,2)':shortest=1,format=yuv420p[vout]`;
      args.push(
        '-filter_complex', filterGraph,
        '-map', '[vout]',
        '-map', audioPresent ? '0:a:0' : '2:a:0',
        '-af', 'loudnorm=I=-16:TP=-1.5:LRA=11,apad',
        '-c:v', 'libx264',
        '-preset', process.env.RENDER_PRESET || 'medium',
        '-crf', process.env.RENDER_CRF || '18',
        '-r', '60',
        '-c:a', 'aac',
        '-b:a', '192k',
        '-ar', '48000',
        '-ac', '2',
        '-movflags', '+faststart',
        '-shortest',
        segment,
      );
      await run(ffmpeg, args);
    }
    segments.push(segment);
    renderedClips.push(clip);
    clip.score = state.scoreOverrides[clip.id] ?? clip.score;
  }

  await saveClips(clips);
  if (!segments.length) throw new Error('None of the selected downloaded files could be found.');

  const listFile = path.join(CACHE, 'concat-list.txt');
  const concatList = segments.map((file) => `file '${file.replaceAll("'", "'\\''")}'`).join('\n') + '\n';
  await writeFile(listFile, concatList);

  const finalVideo = path.join(OUTPUT, `best-of-${YEAR}.mp4`);
  console.log(`Combining ${segments.length} clips in the saved order into ${finalVideo}`);
  await run(ffmpeg, ['-y', '-f', 'concat', '-safe', '0', '-i', listFile, '-c', 'copy', '-movflags', '+faststart', finalVideo]);

  const finalClips = renderedClips.map((clip, index) => ({
    ...clip,
    finalRank: index + 1,
    score: state.scoreOverrides[clip.id] ?? clip.score,
  }));
  await writeClipsCsv(finalClips, path.join(OUTPUT, `best-of-${YEAR}-clips.csv`));
  await writeFile(path.join(OUTPUT, `best-of-${YEAR}-clips.json`), `${JSON.stringify(finalClips, null, 2)}\n`);
  const duration = finalClips.reduce((sum, clip) => sum + (clip.duration ?? 0), 0);
  console.log(`Finished ${finalVideo} (${formatDuration(duration)} estimated).`);
}
