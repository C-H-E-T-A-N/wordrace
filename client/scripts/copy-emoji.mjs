// Copies the Twemoji SVGs the game actually shows into client/public/emoji/ (runs before dev and build).
// Only ~450 of the ~3,700 files are needed, and serving them ourselves keeps LAN play working offline.
import fs from 'node:fs';
import path from 'node:path';
import { createRequire } from 'node:module';
import { fileURLToPath } from 'node:url';
import { POOL } from '../../server/questions.js';
import { DRAW_POOL } from '../../server/drawWords.js';
import { IMPOSTER_POOL } from '../../server/imposterPairs.js';
import { emojiFile, RAIN } from '../src/emoji.js';

const here = path.dirname(fileURLToPath(import.meta.url));
const require = createRequire(import.meta.url);
const source = path.dirname(require.resolve('@twemoji/svg/package.json'));
const target = path.join(here, '../public/emoji');

const wanted = new Set([...POOL, ...DRAW_POOL, ...IMPOSTER_POOL].map(q => q.emoji).concat(RAIN));
fs.mkdirSync(target, { recursive: true });
const missing = [];
for (const char of wanted) {
  const file = `${emojiFile(char)}.svg`;
  const from = path.join(source, file);
  if (fs.existsSync(from)) fs.copyFileSync(from, path.join(target, file));
  else missing.push(`${char} (${file})`);
}
if (missing.length) {
  console.error(`No Twemoji image for: ${missing.join(', ')}. Pick another emoji for these.`);
  process.exit(1);
}
console.log(`copy-emoji: ${wanted.size} images -> public/emoji`);
