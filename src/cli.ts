import 'dotenv/config';
import { scanDiscord } from './discord.js';
import { fetchMetadata } from './medal.js';
import { downloadClips } from './download.js';
import { startReviewServer } from './server.js';
import { renderMontage } from './render.js';

const command = process.argv[2] || 'help';
try {
  if (command === 'scan') await scanDiscord();
  else if (command === 'metadata') await fetchMetadata();
  else if (command === 'download') await downloadClips();
  else if (command === 'review') await startReviewServer();
  else if (command === 'render') await renderMontage();
  else console.log('Commands: scan | metadata | download | review | render\nTypical flow: npm run scan && npm run metadata && npm run download && npm run review, then npm run render');
} catch (error) {
  console.error((error as Error).stack || error);
  process.exitCode = 1;
}
