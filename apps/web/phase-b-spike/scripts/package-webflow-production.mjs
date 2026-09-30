#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  lstatSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  realpathSync,
  writeFileSync,
} from 'node:fs';
import {
  basename,
  dirname,
  extname,
  isAbsolute,
  join,
  relative,
  resolve,
  sep,
} from 'node:path';
import { TextDecoder } from 'node:util';

const APPROVED_PREVIEW_BASE = 'https://pub-a73a77b87d504498bad6ae568754e572.r2.dev';
const APPROVED_PREVIEW_BUCKET = 'invillage-media-preview';
const MAX_OUTPUT_BYTES = 100_000_000;
const MAX_IMAGE_BYTES = 20_000_000;
const TEXT_SCAN_EXTENSIONS = new Set(['.html', '.css', '.js', '.mjs', '.cjs']);
const IMAGE_EXTENSIONS = new Set([
  '.avif', '.bmp', '.gif', '.ico', '.jpeg', '.jpg', '.png', '.svg', '.tif', '.tiff', '.webp',
]);
const HTML_ROUTES = new Map([
  ['index.html', '/'],
  ['spaces.html', '/spaces'],
  ['plan.html', '/plan'],
  ['about.html', '/about'],
  ['contact.html', '/contact'],
  ['404.html', null],
]);
const NORMAL_ROUTES = [...HTML_ROUTES].filter(([, pathname]) => pathname !== null);
const CONTROL_FILES = new Set([
  '_headers', '_redirects', '_routes.json', '_worker.js', 'netlify.toml', 'vercel.json',
  'web.config', 'webflow.json', 'wrangler.json', 'wrangler.jsonc', 'wrangler.toml', '.htaccess',
  'package.json', 'package-lock.json', 'npm-shrinkwrap.json', 'pnpm-lock.yaml', 'yarn.lock',
]);

function fail(message) {
  throw new Error(message);
}

function usage() {
  return [
    'Usage: node scripts/package-webflow-production.mjs --dist DIR --corpus DIR --out NEW_DIR --origin HTTPS_ORIGIN [--mode review|production]',
    'The default mode is review. The audit file is written beside --out as <out>.manifest.json.',
  ].join('\n');
}

function parseArgs(argv) {
  if (argv.length === 1 && argv[0] === '--help') return null;

  const options = {};
  const seen = new Set();
  const accepted = new Set(['--dist', '--corpus', '--out', '--origin', '--mode']);
  for (let index = 0; index < argv.length; index += 1) {
    const flag = argv[index];
    if (!accepted.has(flag)) fail(`Unknown argument: ${flag}`);
    if (seen.has(flag)) fail(`Argument specified more than once: ${flag}`);
    seen.add(flag);
    const value = argv[index + 1];
    if (!value || value.startsWith('--')) fail(`Missing value for ${flag}`);
    options[flag.slice(2)] = value;
    index += 1;
  }

  for (const required of ['dist', 'corpus', 'out', 'origin']) {
    if (!options[required]) fail(`Missing required argument: --${required}`);
  }
  options.mode ??= 'review';
  if (!['review', 'production'].includes(options.mode)) fail('--mode must be review or production');
  return options;
}

function isInside(parent, child) {
  const rel = relative(parent, child);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
}

function requireDirectory(path, label) {
  let info;
  try { info = lstatSync(path); }
  catch { fail(`${label} does not exist`); }
  if (info.isSymbolicLink() || !info.isDirectory()) fail(`${label} must be a regular directory, not a symlink`);
  return realpathSync(path);
}

function pathExists(path) {
  try {
    lstatSync(path);
    return true;
  } catch (error) {
    if (error.code === 'ENOENT') return false;
    throw error;
  }
}

function readSecureCorpusFile(corpusRoot, relativePath) {
  const normalized = relativePath.split('/').join(sep);
  const fullPath = resolve(corpusRoot, normalized);
  if (!isInside(corpusRoot, fullPath)) fail(`Corpus path escapes its root: ${relativePath}`);

  let cursor = corpusRoot;
  for (const component of normalized.split(sep)) {
    cursor = join(cursor, component);
    let info;
    try { info = lstatSync(cursor); }
    catch { fail(`Required corpus input is missing: ${relativePath}`); }
    if (info.isSymbolicLink()) fail(`Corpus input may not use symlinks: ${relativePath}`);
  }
  if (!lstatSync(fullPath).isFile()) fail(`Corpus input is not a regular file: ${relativePath}`);

  const realPath = realpathSync(fullPath);
  if (!isInside(corpusRoot, realPath)) fail(`Corpus input resolves outside its root: ${relativePath}`);
  return { fullPath, bytes: readFileSync(fullPath) };
}

function rejectDistPath(relativePath) {
  const components = relativePath.split('/');
  const fileName = components.at(-1);
  const lowerName = fileName.toLowerCase();
  if (components.some((component) => component.toLowerCase() === 'node_modules')) {
    fail(`Dependency files are not allowed in dist: ${relativePath}`);
  }
  if (components.some((component) => component.startsWith('.'))) {
    fail(`Hidden/control files are not allowed in dist: ${relativePath}`);
  }
  if (CONTROL_FILES.has(lowerName)) fail(`Platform control file is not allowed in dist: ${relativePath}`);
  if (
    /^\.env(?:\..*)?$/i.test(fileName)
    || /^\.dev\.vars(?:\..*)?$/i.test(fileName)
    || /^(?:id_rsa|id_ed25519)(?:\..*)?$/i.test(fileName)
    || /\.(?:pem|key|p12|pfx|keystore)$/i.test(fileName)
    || /(?:secret|credentials?|private[-_.]?key|access[-_.]?token|service[-_.]?account)/i.test(fileName)
  ) {
    fail(`Secret-like file is not allowed in dist: ${relativePath}`);
  }
}

function listDistFiles(distRoot) {
  const files = [];
  const visit = (directory, relativeDirectory) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      const relativePath = relativeDirectory ? `${relativeDirectory}/${entry.name}` : entry.name;
      const fullPath = join(directory, entry.name);
      rejectDistPath(relativePath);

      let info;
      try { info = lstatSync(fullPath); }
      catch { fail(`Could not inspect dist entry: ${relativePath}`); }
      if (info.isSymbolicLink()) fail(`Symlinks are not allowed in dist: ${relativePath}`);
      if (info.isDirectory()) {
        visit(fullPath, relativePath);
      } else if (info.isFile()) {
        files.push({ path: relativePath, fullPath, bytes: info.size });
      } else {
        fail(`Only regular files and directories are allowed in dist: ${relativePath}`);
      }
    }
  };
  visit(distRoot, '');
  return files.sort((left, right) => left.path.localeCompare(right.path));
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function fingerprint(relativePath, buffer) {
  return { path: relativePath, bytes: buffer.byteLength, sha256: sha256(buffer) };
}

function decodeAttribute(value) {
  return value.replace(/&(?:amp|quot|apos|lt|gt);/gi, (entity) => ({
    '&amp;': '&', '&quot;': '"', '&apos;': "'", '&lt;': '<', '&gt;': '>',
  })[entity.toLowerCase()]);
}

function attributeMatches(tag, name) {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'=<>]+))`, 'gi');
  return [...tag.matchAll(pattern)].map((match) => decodeAttribute(match[1] ?? match[2] ?? match[3]));
}

function setAttribute(tag, name, value) {
  const pattern = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"[^"]*"|'[^']*'|[^\\s"'=<>]+)`, 'i');
  if (pattern.test(tag)) return tag.replace(pattern, (match) => {
    const prefix = /^\s/.test(match) ? match.match(/^\s*/)[0] : '';
    return `${prefix}${name}="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"`;
  });
  return tag.replace(/\s*\/?\s*>$/, (closing) => ` ${name}="${value.replaceAll('&', '&amp;').replaceAll('"', '&quot;')}"${closing}`);
}

function findMetadataTags(html, tagName, predicate) {
  return [...html.matchAll(new RegExp(`<${tagName}\\b[^>]*>`, 'gi'))]
    .filter((match) => predicate(match[0]))
    .map((match) => ({ tag: match[0], index: match.index }));
}

function getHeadRange(html, relativePath) {
  const heads = [...html.matchAll(/<head\b[^>]*>[\s\S]*?<\/head\s*>/gi)];
  if (heads.length !== 1) fail(`${relativePath} must have exactly one complete <head>`);
  return { tag: heads[0][0], index: heads[0].index };
}

function updateRobotsAndCanonical(html, relativePath, pathname, options) {
  const head = getHeadRange(html, relativePath);
  const robots = findMetadataTags(html, 'meta', (tag) => attributeMatches(tag, 'name').some((value) => value.toLowerCase() === 'robots'));
  const canonicals = findMetadataTags(html, 'link', (tag) => attributeMatches(tag, 'rel').some((value) => value.toLowerCase().split(/\s+/).includes('canonical')));

  if (robots.length !== 1 || !head.tag.includes(robots[0]?.tag ?? '\u0000')) {
    fail(`${relativePath} must have exactly one robots meta tag in <head>`);
  }
  if (canonicals.length > 1 || (canonicals.length === 1 && !head.tag.includes(canonicals[0].tag))) {
    fail(`${relativePath} has duplicate or out-of-head canonical tags`);
  }

  const robotsContent = attributeMatches(robots[0].tag, 'content');
  if (robotsContent.length !== 1) fail(`${relativePath} robots meta needs exactly one content attribute`);
  const robotsValue = options.mode === 'production' ? 'index,follow' : 'noindex';
  const updatedRobotsTag = setAttribute(robots[0].tag, 'content', robotsValue);
  let updatedHead = head.tag.replace(robots[0].tag, updatedRobotsTag);

  const canonicalUrl = `${options.origin}${pathname}`;
  if (canonicals.length === 1) {
    const updatedCanonicalTag = setAttribute(canonicals[0].tag, 'href', canonicalUrl);
    updatedHead = updatedHead.replace(canonicals[0].tag, updatedCanonicalTag);
  } else {
    updatedHead = updatedHead.replace(/<\/head\s*>/i, `  <link rel="canonical" href="${canonicalUrl}">\n</head>`);
  }

  const output = html.slice(0, head.index) + updatedHead + html.slice(head.index + head.tag.length);
  const finalRobots = findMetadataTags(output, 'meta', (tag) => attributeMatches(tag, 'name').some((value) => value.toLowerCase() === 'robots'));
  const finalCanonicals = findMetadataTags(output, 'link', (tag) => attributeMatches(tag, 'rel').some((value) => value.toLowerCase().split(/\s+/).includes('canonical')));
  if (finalRobots.length !== 1 || attributeMatches(finalRobots[0].tag, 'content')[0] !== robotsValue) {
    fail(`${relativePath} robots metadata did not resolve to the requested mode`);
  }
  if (finalCanonicals.length !== 1 || attributeMatches(finalCanonicals[0].tag, 'href')[0] !== canonicalUrl) {
    fail(`${relativePath} canonical URL did not resolve exactly`);
  }
  return output;
}

function validateNotFound(html) {
  const head = getHeadRange(html, '404.html');
  const robots = findMetadataTags(html, 'meta', (tag) => attributeMatches(tag, 'name').some((value) => value.toLowerCase() === 'robots'));
  const canonicals = findMetadataTags(html, 'link', (tag) => attributeMatches(tag, 'rel').some((value) => value.toLowerCase().split(/\s+/).includes('canonical')));
  if (robots.length !== 1 || !head.tag.includes(robots[0]?.tag ?? '\u0000')) fail('404.html must keep exactly one robots meta tag in <head>');
  const content = attributeMatches(robots[0].tag, 'content');
  if (content.length !== 1 || !content[0].toLowerCase().split(/[\s,]+/).includes('noindex')) fail('404.html must remain noindex');
  if (canonicals.length !== 0) fail('404.html must not have a canonical URL');
}

function countOccurrences(text, needle) {
  let count = 0;
  let start = 0;
  while (true) {
    const index = text.indexOf(needle, start);
    if (index < 0) return count;
    const next = text[index + needle.length];
    if (next === '?' || next === '#') fail('R2 image URLs with query strings or fragments are not supported');
    count += 1;
    start = index + needle.length;
  }
}

function decodeUtf8(buffer, label) {
  try { return new TextDecoder('utf-8', { fatal: true, ignoreBOM: true }).decode(buffer); }
  catch { fail(`Text input is not valid UTF-8: ${label}`); }
}

function validateOrigin(value) {
  let url;
  try { url = new URL(value); }
  catch { fail('--origin must be an HTTPS origin'); }
  if (
    url.protocol !== 'https:'
    || !url.hostname
    || url.username
    || url.password
    || url.pathname !== '/'
    || url.search
    || url.hash
    || url.origin !== value
  ) {
    fail('--origin must be an exact HTTPS origin without a path, query, fragment, or credentials');
  }
  return url.origin;
}

function xmlEscape(value) {
  return value.replaceAll('&', '&amp;').replaceAll('<', '&lt;').replaceAll('>', '&gt;').replaceAll('"', '&quot;').replaceAll("'", '&apos;');
}

function generatedRobots(mode, origin) {
  if (mode === 'review') return 'User-agent: *\nDisallow: /\n';
  return `User-agent: *\nAllow: /\n\nSitemap: ${origin}/sitemap.xml\n`;
}

function generatedSitemap(origin) {
  const entries = NORMAL_ROUTES.map(([, pathname]) => `  <url><loc>${xmlEscape(`${origin}${pathname}`)}</loc></url>`).join('\n');
  return `<?xml version="1.0" encoding="UTF-8"?>\n<urlset xmlns="http://www.sitemaps.org/schemas/sitemap/0.9">\n${entries}\n</urlset>\n`;
}

function hashOutputFiles(files) {
  return [...files.entries()]
    .sort(([left], [right]) => left.localeCompare(right))
    .map(([path, content]) => ({ path, bytes: content.byteLength, sha256: sha256(content) }));
}

function validateOutputPaths(files) {
  const exactPaths = new Set(files.keys());
  const caseFoldedPaths = new Map();
  for (const path of exactPaths) {
    const folded = path.toLowerCase();
    const existing = caseFoldedPaths.get(folded);
    if (existing && existing !== path) fail(`Output paths collide on case-insensitive filesystems: ${existing} and ${path}`);
    caseFoldedPaths.set(folded, path);
  }
  for (const path of exactPaths) {
    const components = path.split('/');
    for (let index = 1; index < components.length; index += 1) {
      const parent = components.slice(0, index).join('/');
      if (exactPaths.has(parent) || caseFoldedPaths.has(parent.toLowerCase())) {
        fail(`Output file/directory paths collide: ${path}`);
      }
    }
  }
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options === null) {
    console.log(usage());
    return;
  }

  const origin = validateOrigin(options.origin);
  const distRoot = requireDirectory(resolve(options.dist), '--dist');
  const corpusRoot = requireDirectory(resolve(options.corpus), '--corpus');
  const outArgument = resolve(options.out);
  const outParentInput = dirname(outArgument);
  let outParent;
  try { outParent = realpathSync(outParentInput); }
  catch { fail('--out parent directory must already exist'); }
  const outPath = join(outParent, basename(outArgument));
  if (pathExists(outPath)) fail('--out must name a new directory that does not already exist');
  const auditPath = `${outPath}.manifest.json`;
  if (pathExists(auditPath)) fail('The external audit manifest already exists; refusing to overwrite it');
  if (isInside(distRoot, outPath) || outPath === distRoot || isInside(corpusRoot, outPath) || outPath === corpusRoot) {
    fail('--out must be outside both input directories');
  }

  const manifestRelativePath = 'assets/manifests/r2-upload-preview.json';
  const galleryRelativePath = 'apps/web/phase-b-spike/reference/spaces-gallery.json';
  const manifestInput = readSecureCorpusFile(corpusRoot, manifestRelativePath);
  const galleryInput = readSecureCorpusFile(corpusRoot, galleryRelativePath);
  const manifest = JSON.parse(decodeUtf8(manifestInput.bytes, manifestRelativePath));
  const gallery = JSON.parse(decodeUtf8(galleryInput.bytes, galleryRelativePath));

  if (manifest.schemaVersion !== 1 || manifest.bucketName !== APPROVED_PREVIEW_BUCKET || manifest.publicBaseUrl !== APPROVED_PREVIEW_BASE) {
    fail('R2 preview manifest does not match the approved schema, bucket, and public host');
  }
  if (!Array.isArray(manifest.items) || !Array.isArray(gallery.galleries)) fail('Required media manifest structure is invalid');

  const heldAssetIds = new Set();
  for (const group of gallery.galleries) {
    if (!Array.isArray(group.photos)) fail('Gallery source has an invalid photos list');
    for (const photo of group.photos) {
      if (photo.status === 'hold') {
        if (!/^[a-f0-9]{24}$/i.test(photo.assetId ?? '')) fail('Held gallery item has an invalid asset ID');
        heldAssetIds.add(photo.assetId);
      }
    }
  }

  const distEntries = listDistFiles(distRoot);
  const htmlPaths = distEntries.filter((entry) => extname(entry.path).toLowerCase() === '.html').map((entry) => entry.path).sort();
  const expectedHtmlPaths = [...HTML_ROUTES.keys()].sort();
  if (JSON.stringify(htmlPaths) !== JSON.stringify(expectedHtmlPaths)) {
    fail(`Dist must contain exactly the six expected HTML files: ${expectedHtmlPaths.join(', ')}`);
  }

  const sourceBuffers = new Map();
  const sourceText = new Map();
  const inputDistFingerprints = [];
  let sourceDistBytes = 0;
  for (const entry of distEntries) {
    const buffer = readFileSync(entry.fullPath);
    if (buffer.byteLength !== entry.bytes) fail(`Dist file changed while being read: ${entry.path}`);
    sourceBuffers.set(entry.path, buffer);
    inputDistFingerprints.push(fingerprint(entry.path, buffer));
    sourceDistBytes += buffer.byteLength;
    if (TEXT_SCAN_EXTENSIONS.has(extname(entry.path).toLowerCase())) {
      sourceText.set(entry.path, decodeUtf8(buffer, entry.path));
    }
  }

  for (const [relativePath, route] of HTML_ROUTES) {
    const html = sourceText.get(relativePath);
    if (html === undefined) fail(`Missing expected HTML source: ${relativePath}`);
    if (route === null) validateNotFound(html);
  }

  const manifestByUrl = new Map();
  for (const item of manifest.items) {
    if (typeof item.remoteUrl !== 'string' || item.remoteUrl.length === 0) continue;
    const list = manifestByUrl.get(item.remoteUrl) ?? [];
    list.push(item);
    manifestByUrl.set(item.remoteUrl, list);
  }

  const selectedItems = [];
  const rewrittenOccurrences = new Map();
  const selectedSourcePaths = new Set();
  for (const [remoteUrl, items] of manifestByUrl) {
    let count = 0;
    for (const text of sourceText.values()) count += countOccurrences(text, remoteUrl);
    if (count === 0) continue;
    if (items.length !== 1) fail('A used remote URL maps to multiple manifest entries');
    const item = items[0];
    let parsedRemote;
    try { parsedRemote = new URL(remoteUrl); }
    catch { fail('A used manifest URL is malformed'); }
    if (
      parsedRemote.origin !== APPROVED_PREVIEW_BASE
      || parsedRemote.pathname !== `/${item.r2Key}`
      || parsedRemote.search
      || parsedRemote.hash
      || item.runtimeEnabled !== true
      || item.contentType !== 'image/jpeg'
      || !/^[a-f0-9]{24}$/i.test(item.assetId ?? '')
      || heldAssetIds.has(item.assetId)
    ) {
      fail('A used remote URL is not an approved, runtime-enabled JPEG or references a held asset');
    }
    if (!/^media\/content\/[a-f0-9]{24}-[a-f0-9]{12}\.jpg$/i.test(item.r2Key ?? '')) fail('A used JPEG has an unexpected R2 key');
    if (!remoteUrl.startsWith(`${APPROVED_PREVIEW_BASE}/`)) fail('A used remote URL does not use the approved preview host');
    if (!Number.isSafeInteger(item.bytes) || item.bytes < 0 || !/^[a-f0-9]{64}$/i.test(item.sha256 ?? '')) {
      fail('A used JPEG has invalid byte or SHA-256 metadata');
    }

    const expectedKey = `media/content/${item.assetId}-${item.sha256.slice(0, 12)}.jpg`;
    if (item.r2Key !== expectedKey) fail('A used JPEG key does not match its asset ID and content hash');
    if (typeof item.localPath !== 'string' || !item.localPath.startsWith(`assets/optimized/${item.assetId}/`)) {
      fail('A used JPEG source must stay under its optimized asset directory');
    }
    const sourceRelativePath = item.localPath;
    if (sourceRelativePath.includes('\\') || sourceRelativePath.split('/').some((part) => part === '' || part === '.' || part === '..')) {
      fail('A used JPEG source path is not a normalized corpus-relative path');
    }
    if (selectedSourcePaths.has(sourceRelativePath)) fail('Multiple used URLs map to the same optimized source file');
    selectedSourcePaths.add(sourceRelativePath);
    const mediaInput = readSecureCorpusFile(corpusRoot, sourceRelativePath);
    const optimizedRoot = resolve(corpusRoot, 'assets/optimized');
    const optimizedInfo = lstatSync(optimizedRoot);
    if (optimizedInfo.isSymbolicLink() || !optimizedInfo.isDirectory()) fail('The optimized media root must be a regular directory');
    const optimizedRealRoot = realpathSync(optimizedRoot);
    if (!isInside(optimizedRoot, mediaInput.fullPath) || !isInside(optimizedRealRoot, realpathSync(mediaInput.fullPath))) {
      fail('A used JPEG source resolves outside assets/optimized');
    }
    if (mediaInput.bytes.byteLength !== item.bytes || sha256(mediaInput.bytes) !== item.sha256) {
      fail(`JPEG source failed the manifest byte/SHA-256 check: ${sourceRelativePath}`);
    }
    if (mediaInput.bytes.byteLength > MAX_IMAGE_BYTES) fail(`Image exceeds ${MAX_IMAGE_BYTES} bytes: ${sourceRelativePath}`);

    const outputName = basename(parsedRemote.pathname);
    if (!/^[a-z0-9._-]+\.jpg$/i.test(outputName)) fail('A used JPEG has an unsafe destination basename');
    const outputPath = `assets/media/${outputName}`;
    if (sourceBuffers.has(outputPath)) fail(`Media destination collides with an existing dist file: ${outputPath}`);
    selectedItems.push({
      remoteUrl,
      sourceRelativePath,
      assetId: item.assetId,
      sha256: item.sha256,
      bytes: item.bytes,
      outputPath,
      outputURL: `${origin}/${outputPath}`,
      buffer: mediaInput.bytes,
    });
    rewrittenOccurrences.set(remoteUrl, count);
  }

  if (selectedItems.length === 0) fail('No approved R2 JPEG URLs were found in dist');
  const outputNames = new Set();
  for (const selected of selectedItems) {
    if (outputNames.has(selected.outputPath)) fail(`Multiple remote URLs collide at ${selected.outputPath}`);
    outputNames.add(selected.outputPath);
  }

  const transformedText = new Map();
  for (const [path, originalText] of sourceText) {
    let text = originalText;
    for (const selected of selectedItems) text = text.split(selected.remoteUrl).join(`/${selected.outputPath}`);
    if (/\.r2\.dev/i.test(text)) fail(`Unmapped .r2.dev reference remains in dist: ${path}`);
    if (HTML_ROUTES.has(path)) {
      const route = HTML_ROUTES.get(path);
      if (route !== null) text = updateRobotsAndCanonical(text, path, route, { mode: options.mode, origin });
    }
    if (text !== originalText) transformedText.set(path, text);
  }

  const outputBuffers = new Map(sourceBuffers);
  for (const [path, text] of transformedText) outputBuffers.set(path, Buffer.from(text, 'utf8'));
  for (const selected of selectedItems) outputBuffers.set(selected.outputPath, selected.buffer);
  outputBuffers.set('robots.txt', Buffer.from(generatedRobots(options.mode, origin), 'utf8'));
  outputBuffers.set('sitemap.xml', Buffer.from(generatedSitemap(origin), 'utf8'));

  validateOutputPaths(outputBuffers);
  if (outputBuffers.has('_redirects')) fail('Production packaging must not include a _redirects file');
  for (const [path, buffer] of outputBuffers) {
    if (/\.r2\.dev/i.test(buffer.toString('latin1'))) fail(`Unmapped .r2.dev bytes remain in packaged output: ${path}`);
    if (IMAGE_EXTENSIONS.has(extname(path).toLowerCase()) && buffer.byteLength > MAX_IMAGE_BYTES) {
      fail(`Packaged image exceeds ${MAX_IMAGE_BYTES} bytes: ${path}`);
    }
  }

  const rawOutputBytes = [...outputBuffers.values()].reduce((total, buffer) => total + buffer.byteLength, 0);
  if (rawOutputBytes > MAX_OUTPUT_BYTES) fail(`Packaged output exceeds ${MAX_OUTPUT_BYTES} raw bytes`);

  const outputFiles = hashOutputFiles(outputBuffers);
  const mediaManifest = selectedItems
    .sort((left, right) => left.outputPath.localeCompare(right.outputPath))
    .map(({ remoteUrl, sourceRelativePath, assetId, sha256: digest, bytes, outputURL }) => ({
      sourceRemoteUrl: remoteUrl,
      sourceRelativePath,
      assetId,
      sha256: digest,
      bytes,
      outputURL,
    }));
  const audit = {
    schemaVersion: 1,
    mode: options.mode,
    origin,
    inputs: {
      distFiles: inputDistFingerprints,
      corpusFiles: [
        fingerprint(manifestRelativePath, manifestInput.bytes),
        fingerprint(galleryRelativePath, galleryInput.bytes),
      ],
      selectedMedia: mediaManifest,
    },
    outputFiles,
    totals: {
      sourceDistFileCount: inputDistFingerprints.length,
      sourceDistBytes,
      selectedMediaCount: mediaManifest.length,
      selectedMediaBytes: mediaManifest.reduce((total, item) => total + item.bytes, 0),
      uniqueAssetCount: new Set(mediaManifest.map((item) => item.assetId)).size,
      rewrittenUrlCount: rewrittenOccurrences.size,
      rewrittenOccurrenceCount: [...rewrittenOccurrences.values()].reduce((total, count) => total + count, 0),
      outputFileCount: outputFiles.length,
      rawOutputBytes,
    },
  };

  mkdirSync(outPath);
  for (const [relativePath, buffer] of outputBuffers) {
    const target = join(outPath, ...relativePath.split('/'));
    mkdirSync(dirname(target), { recursive: true });
    writeFileSync(target, buffer, { flag: 'wx' });
  }

  const verifiedOutputFiles = [];
  for (const expected of outputFiles) {
    const target = join(outPath, ...expected.path.split('/'));
    const actual = readFileSync(target);
    const actualFingerprint = fingerprint(expected.path, actual);
    if (actualFingerprint.bytes !== expected.bytes || actualFingerprint.sha256 !== expected.sha256) {
      fail(`Packaged output failed its readback check: ${expected.path}`);
    }
    verifiedOutputFiles.push(actualFingerprint);
  }
  audit.outputFiles = verifiedOutputFiles;
  writeFileSync(auditPath, `${JSON.stringify(audit, null, 2)}\n`, { flag: 'wx' });

  console.log(JSON.stringify({
    mode: options.mode,
    origin,
    mediaFiles: mediaManifest.length,
    rewrittenOccurrences: audit.totals.rewrittenOccurrenceCount,
    outputFiles: audit.totals.outputFileCount,
    rawOutputBytes: audit.totals.rawOutputBytes,
  }));
}

try {
  main();
} catch (error) {
  console.error(`Packaging failed: ${error.message}`);
  process.exitCode = 1;
}
