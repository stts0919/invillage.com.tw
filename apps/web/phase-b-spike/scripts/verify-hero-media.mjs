import { createHash } from 'node:crypto';
import { readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const repositoryRoot = resolve(scriptDirectory, '../../../..');
const manifestPath = resolve(repositoryRoot, 'assets/manifests/hero-video-candidate-002.json');
const manifest = JSON.parse(readFileSync(manifestPath, 'utf8'));
const selectedRoles = [
  'desktop-video',
  'mobile-landscape-video',
  'desktop-poster',
  'mobile-landscape-poster',
];

if (manifest.schemaVersion !== 1 || !manifest.selection?.useFullSource) {
  throw new Error('Hero media manifest does not match the selected full-length source');
}

const results = [];
for (const role of selectedRoles) {
  const item = manifest.outputs.find((output) => output.role === role);
  if (!item) throw new Error(`Missing Hero media role: ${role}`);
  const path = resolve(repositoryRoot, item.path);
  if (!path.startsWith(`${repositoryRoot}${sep}assets${sep}optimized${sep}hero-video${sep}`)) {
    throw new Error(`Hero media path is outside approved local assets: ${role}`);
  }
  const bytes = statSync(path).size;
  const sha256 = createHash('sha256').update(readFileSync(path)).digest('hex');
  if (bytes !== item.bytes || sha256 !== item.sha256) {
    throw new Error(`Hero media integrity mismatch: ${role}`);
  }
  results.push({ role, bytes });
}

console.log(JSON.stringify({ manifest: 'hero-video-candidate-002.json', verified: results }, null, 2));
