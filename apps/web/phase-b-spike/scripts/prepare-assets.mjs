import { createHash } from 'node:crypto';
import { constants, copyFileSync, existsSync, mkdirSync, readFileSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const spikeRoot = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(spikeRoot, '../../..');
const outputRoot = resolve(spikeRoot, 'public/assets');
const reference = JSON.parse(readFileSync(resolve(spikeRoot, 'reference/legacy-slice.json'), 'utf8'));

const assets = [
  {
    source: reference.brand.logoPath,
    sha256: reference.brand.logoSha256,
    output: 'brand/logo.png',
  },
  {
    source: reference.brand.faviconPath,
    sha256: reference.brand.faviconSha256,
    output: 'icons/favicon.png',
  },
  {
    source: reference.brand.regularFontPath,
    sha256: reference.brand.regularFontSha256,
    output: 'fonts/harmonyos-regular.ttf',
  },
  {
    source: reference.brand.boldFontPath,
    sha256: reference.brand.boldFontSha256,
    output: 'fonts/harmonyos-bold.ttf',
  },
  {
    source: reference.home.heroFallbackImage.localPath,
    sha256: reference.home.heroFallbackImage.sha256,
    output: 'images/hero-still.jpg',
  },
  ...reference.roomsSample.map((room) => ({
    source: room.imageLocalPath,
    sha256: room.imageSha256,
    output: `images/${room.id}.jpg`,
  })),
];

function containedPath(root, relativePath) {
  const path = resolve(root, relativePath);
  if (!path.startsWith(`${root}${sep}`)) {
    throw new Error(`Path escapes its root: ${relativePath}`);
  }
  return path;
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

const results = [];
for (const asset of assets) {
  const sourcePath = containedPath(repositoryRoot, asset.source);
  const outputPath = containedPath(outputRoot, asset.output);
  if (!existsSync(sourcePath)) {
    throw new Error(`Missing source: ${asset.source}`);
  }
  if (sha256(sourcePath) !== asset.sha256) {
    throw new Error(`Source checksum mismatch: ${asset.source}`);
  }

  mkdirSync(dirname(outputPath), { recursive: true });
  if (!existsSync(outputPath)) {
    copyFileSync(sourcePath, outputPath, constants.COPYFILE_EXCL);
  }
  if (sha256(outputPath) !== asset.sha256) {
    throw new Error(`Prepared asset checksum mismatch: ${asset.output}`);
  }
  results.push({ output: asset.output, bytes: statSync(outputPath).size });
}

console.log(JSON.stringify({ preparedAssets: results }, null, 2));
