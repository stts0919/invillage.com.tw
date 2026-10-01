#!/usr/bin/env node
/** 唯讀驗證本機renderer與Designer移植包；不寫檔、不抓網路、不呼叫Webflow。 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, readdirSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { inventoryDesignerInputs, parseHtml } from './package-designer-pages.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const DEFAULT_DIST = resolve(dirname(SCRIPT), '../dist');
const SITE_ID = '65009115380adfba3ebe2328';
const ROUTES = new Map([['index', '/'], ['spaces', '/spaces'], ['plan', '/plan'], ['about', '/about'], ['contact', '/contact'], ['404', '/404']]);
const HOLDS = new Set(['651d4f6f5a6041010d0df333', '651ec6d7132a2cfb80d4309e']);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const requireThat = (condition, message) => { if (!condition) throw new Error(message); };
const attr = (node, name) => new Map(node.attrs ?? []).get(name);
const hasClass = (node, name) => (attr(node, 'class') ?? '').split(/\s+/).includes(name);
const walk = (node, visitor) => { if (node.tag) visitor(node); for (const child of node.children ?? []) walk(child, visitor); };
const all = (node, predicate) => { const found = []; walk(node, (item) => { if (predicate(item)) found.push(item); }); return found; };
const one = (nodes, label) => { requireThat(nodes.length === 1, `${label}: expected one, got ${nodes.length}`); return nodes[0]; };
const text = (node) => node.text !== undefined ? node.text : ['script', 'style'].includes(node.tag) ? '' : (node.children ?? []).map(text).join('');
const digestList = (items) => sha(items.join('\n'));
const compare = (actual, expected, label) => requireThat(JSON.stringify(actual) === JSON.stringify(expected), `${label}: source mismatch`);
const nodesWithIds = (tree) => all(tree, (node) => attr(node, 'id') !== undefined).map((node) => attr(node, 'id'));
const images = (tree) => all(tree, (node) => node.tag === 'img');
const alts = (tree) => images(tree).map((node) => { requireThat(attr(node, 'alt') !== undefined, 'Image missing alt'); return attr(node, 'alt'); });

function rootDirectory(path, label) {
  const resolved = resolve(path);
  requireThat(lstatSync(resolved).isDirectory() && !lstatSync(resolved).isSymbolicLink(), `${label}: not a regular directory`);
  requireThat(realpathSync(resolved) === resolved, `${label}: symlink path is not allowed`);
  return resolved;
}
function read(root, name) {
  requireThat(typeof name === 'string' && name.length > 0 && !isAbsolute(name) && !/[\\\0?#]/.test(name), 'Unsafe file path');
  const parts = name.split('/');
  requireThat(parts.every((part) => part && part !== '.' && part !== '..'), 'Unsafe file path segment');
  const path = resolve(root, name);
  const rel = relative(root, path);
  requireThat(rel && !rel.startsWith(`..${sep}`) && rel !== '..' && !isAbsolute(rel), 'File escapes root');
  let cursor = root;
  for (const part of parts) { cursor = join(cursor, part); requireThat(!lstatSync(cursor).isSymbolicLink(), 'File symlink is not allowed'); }
  requireThat(lstatSync(path).isFile(), 'Input must be a regular file');
  return readFileSync(path);
}
function listFiles(root) {
  const files = [];
  const visit = (directory, prefix) => {
    for (const entry of readdirSync(directory, { withFileTypes: true })) {
      requireThat(!entry.isSymbolicLink(), 'Package symlink is not allowed');
      const name = prefix ? `${prefix}/${entry.name}` : entry.name;
      if (entry.isDirectory()) visit(join(directory, entry.name), name);
      else { requireThat(entry.isFile(), 'Non-regular package entry'); files.push(name); }
    }
  };
  visit(root, ''); return files.sort();
}
function hex(value, label) { requireThat(typeof value === 'string' && /^[a-f0-9]{64}$/.test(value), `${label}: invalid SHA-256`); return value; }
function copyHashField(record, canonical, legacy) {
  const value = record[canonical] ?? record[legacy];
  hex(value, canonical);
  if (record[canonical] !== undefined && record[legacy] !== undefined) compare(record[canonical], record[legacy], canonical);
  return value;
}
function projected(node) {
  if (!node.tag) return { ...node };
  if (['script', 'style', 'noscript'].includes(node.tag)) return null;
  if (node.tag === 'astro-island') return structuredClone(one(all(node, (item) => item.tag === 'h1'), 'Source island H1'));
  return { ...node, children: node.children.map(projected).filter(Boolean) };
}
function unpack([kind, value]) {
  requireThat(kind === 0 || kind === 1, 'Unsupported source Astro props encoding');
  if (kind === 1) return value.map(unpack);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpack(item)]));
  return value;
}
function cssWithoutLiterals(css) {
  return css.replace(/\/\*[\s\S]*?\*\//g, '').replace(/url\(\s*(?:"[^"\n]*"|'[^'\n]*'|[^)]*)\s*\)/gi, '')
    .replace(/"(?:\\.|[^"\\])*"|'(?:\\.|[^'\\])*'/g, '');
}

export function verifyDesignerPackage({ packageDir, dist: distDirectory = DEFAULT_DIST }) {
  const directory = rootDirectory(packageDir, 'package');
  const dist = rootDirectory(distDirectory, 'renderer dist');
  const manifestBytes = read(directory, 'package-manifest.json');
  const manifest = JSON.parse(manifestBytes);
  requireThat(manifest.schemaVersion === 1 && manifest.siteId === SITE_ID, 'Manifest schema/siteId mismatch');
  requireThat(manifest.fixtureOnly === false && manifest.mappingComplete === true, 'Package is not a mapped native delivery');
  requireThat(Number.isSafeInteger(manifest.maxFragmentCharactersExclusive) && manifest.maxFragmentCharactersExclusive > 0 && manifest.maxFragmentCharactersExclusive <= 50_000, 'Unsafe fragment character limit');
  hex(manifest.inputMappingSha256, 'Input mapping');
  compare(sha(readFileSync(resolve(dirname(SCRIPT), 'package-designer-pages.mjs'))), hex(manifest.scriptSha256, 'Packager'), 'Packager source SHA');
  requireThat(Array.isArray(manifest.inputs) && Array.isArray(manifest.files) && Array.isArray(manifest.routes) && Array.isArray(manifest.assetMappings), 'Missing manifest collections');
  const inventory = inventoryDesignerInputs(dist);
  compare(manifest.inputs.map((row) => row.path).sort(), inventory.inputFingerprints.map((row) => row.path).sort(), 'Renderer input inventory');
  for (const row of manifest.inputs) {
    const bytes = read(dist, row.path);
    requireThat(bytes.length === row.bytes && sha(bytes) === hex(row.sha256, 'Input'), `Renderer input fingerprint mismatch: ${row.path}`);
  }
  const records = new Map();
  const contents = new Map();
  const trees = new Map();
  for (const row of manifest.files) {
    requireThat(!records.has(row.path), 'Duplicate package file record');
    const bytes = read(directory, row.path);
    const content = bytes.toString('utf8');
    requireThat(bytes.length === row.bytes && content.length === row.characters && sha(bytes) === hex(row.sha256, 'Output'), `Package file fingerprint mismatch: ${row.path}`);
    if (row.unicodeCharacters !== undefined) compare([...content].length, row.unicodeCharacters, 'Unicode character count');
    records.set(row.path, row); contents.set(row.path, content);
    if (row.path.endsWith('.html')) {
      requireThat(content.length < 50_000 && content.length < manifest.maxFragmentCharactersExclusive, `Fragment length exceeds limit: ${row.path}`);
      const tree = parseHtml(content);
      const roots = tree.children.filter((node) => node.tag || node.text.trim());
      requireThat(roots.length === 1 && roots[0].tag, `Fragment must have one element root: ${row.path}`);
      requireThat(all(tree, (node) => ['html', 'head', 'body', 'script', 'astro-island', 'iframe'].includes(node.tag)).length === 0, `Forbidden native tag: ${row.path}`);
      if (!row.path.startsWith('head/')) requireThat(all(tree, (node) => node.tag === 'style').length === 0, 'Native markup must not contain style tags');
      trees.set(row.path, tree);
    }
  }
  compare(listFiles(directory), [...records.keys(), 'package-manifest.json'].sort(), 'Package file inventory');
  const expectedHashes = new Set(inventory.requiredAssetUrls.map(sha));
  const sourceMappings = new Map();
  const targetWidths = new Map();
  const targetUrls = new Set();
  for (const row of manifest.assetMappings) {
    hex(row.sourceUrlSha256, 'Source URL');
    requireThat(expectedHashes.has(row.sourceUrlSha256) && !sourceMappings.has(row.sourceUrlSha256), 'Unknown or duplicate asset mapping source');
    const url = new URL(row.target);
    requireThat(url.protocol === 'https:' && !url.username && !url.password && !url.port && !url.search && !url.hash, 'Unsafe mapped asset URL');
    const cdn = ['cdn.prod.website-files.com', 'assets-global.website-files.com', 'assets.website-files.com'].includes(url.hostname) && url.pathname.startsWith(`/${SITE_ID}/`);
    const library = url.hostname === 's3.amazonaws.com' && url.pathname.startsWith(`/webflow-prod-assets/${SITE_ID}/`);
    const legacy = url.hostname === 'uploads-ssl.webflow.com' && url.pathname.startsWith(`/${SITE_ID}/`);
    requireThat(cdn || library || legacy, 'Mapped asset is not in the original site library');
    requireThat(Number.isSafeInteger(row.usages) && row.usages > 0, 'Invalid asset mapping usage count');
    if (row.targetWidth !== null && row.targetWidth !== undefined) {
      requireThat(Number.isSafeInteger(row.targetWidth) && row.targetWidth > 0, 'Invalid managed width');
      requireThat(!targetWidths.has(row.target) || targetWidths.get(row.target) === row.targetWidth, 'Inconsistent target width metadata');
      targetWidths.set(row.target, row.targetWidth);
    }
    sourceMappings.set(row.sourceUrlSha256, row); targetUrls.add(row.target);
  }
  compare([...sourceMappings.keys()].sort(), [...expectedHashes].sort(), 'Complete source URL mapping');
  const mapped = (source) => {
    const row = sourceMappings.get(sha(source));
    requireThat(row, 'Source asset has no exact mapping'); return row.target;
  };
  const widthOf = (source) => {
    const row = sourceMappings.get(sha(source));
    requireThat(row, 'Source image has no mapping');
    const width = row.targetWidth ?? targetWidths.get(row.target);
    requireThat(Number.isSafeInteger(width) && width > 0, 'Image has no actual target width'); return width;
  };
  const knownClasses = new Set();
  const knownVariables = new Set();
  requireThat(manifest.names?.classes && manifest.names?.variables, 'Missing iv1 name mapping');
  for (const [source, target] of Object.entries(manifest.names.classes)) {
    requireThat(target === `iv1-${source}`, 'Invalid class namespace mapping'); knownClasses.add(target);
  }
  for (const [source, target] of Object.entries(manifest.names.variables)) {
    requireThat(source.startsWith('--') && target === `--iv1-${source.slice(2)}`, 'Invalid CSS variable namespace mapping'); knownVariables.add(target);
  }
  function assetUrl(value, label) {
    const url = new URL(value);
    requireThat(url.protocol === 'https:' && !/(?:^|\.)(?:r2\.dev|webflow\.io|pages\.dev|localhost)$/.test(url.hostname) && !['127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname), `${label}: forbidden runtime origin`);
    requireThat(targetUrls.has(value), `${label}: URL is not in the declared asset mapping`);
  }
  function srcsetEntries(value) {
    return value.split(',').map((entry) => {
      const match = /^\s*(\S+)(?:\s+(\d+(?:\.\d+)?[wx]))?\s*$/.exec(entry);
      requireThat(match, 'Invalid srcset syntax'); return { url: match[1], descriptor: match[2] ?? null };
    });
  }
  function expectedSrcset(value) {
    return srcsetEntries(value).map((entry) => ({ url: mapped(entry.url), descriptor: entry.descriptor?.endsWith('w') && manifest.actualWidthMetadataProvided
      ? `${widthOf(entry.url)}w` : entry.descriptor }));
  }
  function compareImages(actual, source, label) {
    compare(actual.length, source.length, `${label} image count`);
    actual.forEach((node, index) => {
      for (const name of ['alt', 'sizes', 'width', 'height', 'loading', 'decoding', 'fetchpriority']) compare(attr(node, name), attr(source[index], name), `${label} img ${name}`);
      compare(attr(node, 'src'), mapped(attr(source[index], 'src')), `${label} img source URL`);
      const original = attr(source[index], 'srcset');
      compare(original === undefined ? undefined : expectedSrcset(original), attr(node, 'srcset') === undefined ? undefined : srcsetEntries(attr(node, 'srcset')), `${label} image srcset`);
    });
  }
  const sources = new Map();
  const navigation = new Set();
  for (const [slug] of ROUTES) {
    const document = parseHtml(read(dist, `${slug}.html`).toString('utf8'));
    const body = one(all(document, (node) => node.tag === 'body'), 'Renderer body');
    const native = projected(body);
    sources.set(slug, { document, body, native });
    for (const link of all(native, (node) => node.tag === 'a')) navigation.add(attr(link, 'href'));
  }
  for (const [path, tree] of trees) {
    walk(tree, (node) => {
      for (const name of (attr(node, 'class') ?? '').split(/\s+/).filter(Boolean)) requireThat(name.startsWith('iv1-') && knownClasses.has(name), `${path}: unprefixed or unknown class`);
      for (const [name, value] of node.attrs) {
        requireThat(!/^on/i.test(name), 'Inline event handler is not allowed');
        if (value === null) continue;
        if (['src', 'poster'].includes(name)) assetUrl(value, path);
        if (name === 'srcset') {
          const entries = srcsetEntries(value); const descriptors = new Set();
          for (const entry of entries) {
            assetUrl(entry.url, path);
            if (entry.descriptor) { requireThat(!descriptors.has(entry.descriptor), 'Duplicate srcset descriptor'); descriptors.add(entry.descriptor); }
            if (entry.descriptor?.endsWith('w') && manifest.actualWidthMetadataProvided) compare(Number(entry.descriptor.slice(0, -1)), targetWidths.get(entry.url), 'Managed srcset descriptor');
          }
        }
        if (name === 'href') {
          if (targetUrls.has(value)) assetUrl(value, path);
          else {
            if (/^https?:\/\//i.test(value)) {
              const host = new URL(value).hostname;
              requireThat(!/(?:^|\.)(?:r2\.dev|webflow\.io|pages\.dev|localhost)$/.test(host) && !['127.0.0.1', '[::1]'].includes(host), 'Forbidden navigation origin');
            }
            requireThat(navigation.has(value), 'Navigation href is not in renderer source');
          }
        }
        if (!['src', 'poster', 'srcset', 'href', 'xmlns', 'xmlns:xlink'].includes(name) && /^(?:https?:\/\/|\/|\.\.?\/)/.test(value)) {
          if (!(name === 'data-iv1-route' && [...ROUTES.values()].includes(value))) assetUrl(value, path);
        }
      }
      if (node.tag === 'style' || attr(node, 'style') !== undefined) {
        const css = node.tag === 'style' ? node.children.map((child) => child.text ?? '').join('') : attr(node, 'style');
        requireThat(!/@import\b/i.test(css), 'CSS import is not allowed');
        for (const match of css.matchAll(/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s]*))\s*\)/gi)) assetUrl(match[1] ?? match[2] ?? match[3], path);
        // image-set等可直接使用字串URL，不能只掃url()。
        for (const match of css.matchAll(/"([^"\n]*)"|'([^'\n]*)'/g)) {
          const value = match[1] ?? match[2];
          if (/^(?:https?:\/\/|\/|\.\.?\/)/.test(value)) assetUrl(value, path);
        }
        const tokens = cssWithoutLiterals(css);
        for (const match of tokens.matchAll(/\.([a-zA-Z_][\w-]*)/g)) requireThat(match[1].startsWith('iv1-') && knownClasses.has(match[1]), 'Unprefixed CSS class selector');
        for (const match of tokens.matchAll(/(?<![\w-])--[a-zA-Z_][\w-]*/g)) requireThat(knownVariables.has(match[0]), 'Unprefixed or unknown CSS custom property');
      }
    });
  }
  requireThat(manifest.routes.length === 6 && new Set(manifest.routes.map((row) => row.slug)).size === 6, 'Must declare exactly six routes');
  const routeResults = [];
  for (const [slug, route] of ROUTES) {
    const row = one(manifest.routes.filter((item) => item.slug === slug), 'Route record');
    compare(row.route, route, 'Route'); compare(row.native, `pages/${slug}.html`, 'Native page path');
    const tree = trees.get(row.native); requireThat(tree, 'Missing native page');
    const pageRecord = records.get(row.native);
    requireThat(pageRecord.kind === 'native-page' && pageRecord.route === route && pageRecord.nativeH1 === 1 && pageRecord.ctas === (slug === '404' ? 0 : 1), 'Native file manifest metadata mismatch');
    const source = sources.get(slug).native;
    const h1 = one(all(tree, (node) => node.tag === 'h1'), `${route} native H1`);
    compare(text(h1), text(one(all(source, (node) => node.tag === 'h1'), 'Source H1')), 'H1 source text'); compare(text(h1), row.nativeH1, 'H1 manifest text');
    const ctas = all(tree, (node) => hasClass(node, 'iv1-primary-cta'));
    compare(ctas.length, slug === '404' ? 0 : 1, `${route} CTA count`);
    requireThat(ctas.every((node) => attr(node, 'href') === 'https://m.me/invillagewulai' && text(node) === '立刻洽詢'), 'CTA destination/copy mismatch');
    const ids = nodesWithIds(tree); requireThat(new Set(ids).size === ids.length, 'Duplicate native ID'); compare(ids, nodesWithIds(source), 'Native/source IDs'); compare(ids, row.ids, 'Manifest IDs');
    const wrapper = one(all(tree, (node) => attr(node, 'id') === 'smooth-wrapper'), 'Page-layer wrapper');
    const content = one(all(wrapper, (node) => attr(node, 'id') === 'smooth-content'), 'Page-layer content');
    requireThat(all(wrapper, (node) => node.tag === 'header').length === 0 && all(content, (node) => node.tag === 'footer').length === 1, 'Header/footer smoother ownership mismatch');
    const sourceCopy = sha(text(source)); const nativeCopy = sha(text(tree));
    compare(sourceCopy, copyHashField(row, 'sourceCopyTextSha256', 'sourceCopySha256'), 'Source copy SHA');
    compare(nativeCopy, copyHashField(row, 'nativeCopyTextSha256', 'nativeCopySha256'), 'Native copy SHA'); compare(nativeCopy, sourceCopy, 'Source/native text SHA');
    const sourceAlt = digestList(alts(source)); const nativeAlt = digestList(alts(tree)); compare(nativeAlt, sourceAlt, 'Source/native alt SHA');
    compareImages(images(tree), images(source), route);
    const header = one(all(tree, (node) => node.tag === 'header'), 'Native header');
    const sharedHeader = trees.get(row.header); requireThat(sharedHeader, 'Missing shared header');
    compare(all(sharedHeader, (node) => node.tag === 'header')[0], header, 'Shared/page header');
    compare(one(all(trees.get(row.footer), (node) => node.tag === 'footer'), 'Shared footer'), one(all(content, (node) => node.tag === 'footer'), 'Page footer'), 'Shared/page footer');
    for (const head of row.head) requireThat(records.has(head) && head.startsWith('head/'), 'Missing head fragment');
    if (slug === 'plan') requireThat(all(tree, (node) => node.tag === 'details').length === 6 && all(tree, (node) => node.tag === 'details').every((node) => attr(node, 'name') === 'plan-group'), 'Plan-group contract mismatch');
    if (slug === 'about') requireThat(all(tree, (node) => hasClass(node, 'iv1-secondary-nearby-card')).length === 10 && ids.includes('about-iot-heading'), 'About ten-card/IoT contract mismatch');
    if (slug === '404') requireThat(row.utility404 === true, '404 must target native Utility 404');
    routeResults.push({ route, sourceCopyTextSha256: sourceCopy, nativeCopyTextSha256: nativeCopy, sourceAltSha256: sourceAlt, nativeAltSha256: nativeAlt, h1: 1, ctas: ctas.length });
  }
  const spaceRoute = manifest.routes.find((row) => row.slug === 'spaces');
  const sourceSpace = sources.get('spaces').body;
  const fallbackSource = one(all(sourceSpace, (node) => hasClass(node, 'spaces-fallback')), 'Source fallback');
  const embedRecords = manifest.files.filter((row) => row.kind === 'noscript-embed');
  requireThat(embedRecords.length === 2 && spaceRoute.fallback.chunks === 2, 'Exactly two fallback embeds are required');
  const slots = all(trees.get(spaceRoute.native), (node) => attr(node, 'data-iv1-embed-slot') !== undefined).map((node) => attr(node, 'data-iv1-embed-slot'));
  compare(slots, embedRecords.map((row) => row.path), 'Fallback embed slot order');
  const fallbackArticles = []; const fallbackImages = []; const fallbackIds = []; const fallbackHeadings = [];
  for (const row of embedRecords) {
    const tree = trees.get(row.path); const root = tree.children.find((node) => node.tag);
    requireThat(root.tag === 'noscript' && all(tree, (node) => node.tag === 'h1').length === 0, 'Fallback must be noscript without duplicate H1');
    const section = one(all(root, (node) => hasClass(node, 'iv1-spaces-fallback')), 'Fallback section');
    requireThat(section.children.every((node) => node.text !== undefined && !node.text.trim() || ['h2', 'article'].includes(node.tag)), 'Fallback split is not complete heading/article blocks');
    const articles = all(section, (node) => node.tag === 'article'); const imgs = images(section);
    compare(articles.length, row.articles, 'Embed article count'); compare(imgs.length, row.images, 'Embed image count');
    fallbackArticles.push(...articles); fallbackImages.push(...imgs);
    fallbackIds.push(...all(section, (node) => attr(node, 'data-gallery-asset-id') !== undefined).map((node) => attr(node, 'data-gallery-asset-id')));
    fallbackHeadings.push(...all(section, (node) => node.tag === 'h2').map(text));
  }
  compare(fallbackArticles.length, 16, 'Fallback article count'); compare(fallbackImages.length, 78, 'Fallback photo count');
  compare(new Set(fallbackIds).size, 77, 'Fallback unique IDs'); requireThat(!fallbackIds.some((id) => HOLDS.has(id)), 'Held photo leaked into fallback');
  compare(fallbackIds, all(fallbackSource, (node) => attr(node, 'data-gallery-asset-id') !== undefined).map((node) => attr(node, 'data-gallery-asset-id')), 'Fallback source photo IDs/order');
  compare(fallbackHeadings, all(fallbackSource, (node) => node.tag === 'h2').map(text), 'Fallback group headings');
  const fallbackCopy = digestList(fallbackArticles.map(text)); const sourceFallbackCopy = digestList(all(fallbackSource, (node) => node.tag === 'article').map(text));
  const fallbackAlt = digestList(fallbackImages.map((node) => attr(node, 'alt'))); const sourceFallbackAlt = digestList(alts(fallbackSource));
  for (const value of [spaceRoute.fallback.orderedArticleTextSha256, spaceRoute.fallback.outputArticleTextSha256, sourceFallbackCopy]) compare(fallbackCopy, value, 'Fallback article text SHA');
  for (const value of [spaceRoute.fallback.orderedImageAltsSha256, spaceRoute.fallback.outputImageAltsSha256, sourceFallbackAlt]) compare(fallbackAlt, value, 'Fallback alt SHA');
  compareImages(fallbackImages, images(fallbackSource), 'Fallback');
  requireThat(spaceRoute.fallback.articles === 16 && spaceRoute.fallback.images === 78 && spaceRoute.fallback.uniqueAssets === 77 && spaceRoute.fallback.heldAssetsIncluded === 0, 'Fallback manifest counts mismatch');
  const island = one(all(sourceSpace, (node) => node.tag === 'astro-island'), 'Source Spaces island');
  const encoded = JSON.parse(attr(island, 'props'));
  const sourceData = Object.fromEntries(Object.entries(encoded).map(([key, value]) => [key, unpack(value)]));
  function mapData(value) {
    if (typeof value === 'string' && /^(?:\/assets\/|\/_astro\/|https?:\/\/|\/\/)/.test(value)) return mapped(value);
    if (Array.isArray(value)) return value.map(mapData);
    if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapData(item)]));
    return value;
  }
  const expectedData = mapData(sourceData);
  if (manifest.actualWidthMetadataProvided) {
    const originalItems = [...sourceData.sharedSpaces, ...sourceData.rooms];
    [...expectedData.sharedSpaces, ...expectedData.rooms].forEach((item, index) => {
      const original = originalItems[index];
      item.media.widths = Object.fromEntries(['small', 'medium', 'large'].map((role) => [role, widthOf(original.media[role])]));
      item.gallery.forEach((photo, photoIndex) => photo.variants.forEach((variant, variantIndex) => {
        variant.width = widthOf(original.gallery[photoIndex].variants[variantIndex].url);
      }));
    });
  }
  const dataPath = one(spaceRoute.integrations.filter((row) => row.component === 'SpacesExplorer'), 'Spaces integration').data;
  const data = JSON.parse(contents.get(dataPath));
  requireThat(records.get(dataPath)?.kind === 'code-component-data' && records.get(dataPath)?.photoPositions === 78, 'Component file manifest metadata mismatch');
  compare(data, { schemaVersion: 1, renderNativeH1: false, ...expectedData }, 'Component data/source mapping and widths');
  const itemList = [...data.sharedSpaces, ...data.rooms];
  requireThat(data.sharedSpaces.length === 10 && data.rooms.length === 6, 'Component space count mismatch');
  const photoIds = itemList.flatMap((item) => item.gallery.map((photo) => photo.assetId));
  compare(photoIds, fallbackIds, 'Component/fallback photo membership'); requireThat(photoIds.length === 78 && new Set(photoIds).size === 77 && !photoIds.some((id) => HOLDS.has(id)), 'Component photo/hold contract mismatch');
  for (const item of itemList) {
    for (const role of ['small', 'medium', 'large']) assetUrl(item.media[role], 'Component stage');
    for (const photo of item.gallery) for (const variant of photo.variants) {
      assetUrl(variant.url, 'Component photo');
      if (manifest.actualWidthMetadataProvided) compare(variant.width, targetWidths.get(variant.url), 'Component target width');
    }
  }
  return { schemaVersion: 1, status: 'PASS', scope: 'local-renderer/native-package-only', verifierSha256: sha(readFileSync(SCRIPT)),
    packagerSha256: manifest.scriptSha256, packageManifestSha256: sha(manifestBytes), rendererInputs: manifest.inputs.length,
    packageFiles: records.size + 1, mappedAssets: sourceMappings.size, routes: routeResults,
    fallback: { articles: 16, images: 78, uniqueAssets: 77, holds: 0, textSha256: fallbackCopy, altSha256: fallbackAlt,
      embeds: embedRecords.map((row) => ({ path: row.path, characters: contents.get(row.path).length })) },
    remoteVerified: false, gaps: ['native package驗證不等於Designer class/button讀回；WHTML styleNames、button實際tag/attrs/children仍須獨立核對', 'Webflow/WHTML實際匯入讀回、managed資產身份與HTTP bytes/尺寸', 'Designer/Shadow DOM響應式、GSAP、Hero、焦點與真機', 'staging/正式route status、SEO、發布與回退；本驗證器沒有發布任何歷史草稿'] };
}

function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--help') { console.log('node scripts/verify-designer-package.mjs --package-dir DIR [--dist RENDERER_DIST]\n唯讀；renderer預設同切片dist；PASS/exit0或FAIL/exit1。'); return; }
    const key = ({ '--package-dir': 'packageDir', '--dist': 'dist' })[args[index]];
    requireThat(key && options[key] === undefined && args[index + 1] && !args[index + 1].startsWith('--'), 'Unknown/duplicate/missing CLI argument');
    options[key] = args[++index];
  }
  requireThat(options.packageDir, '--package-dir is required');
  console.log(JSON.stringify(verifyDesignerPackage(options), null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(JSON.stringify({ status: 'FAIL', scope: 'local-renderer/native-package-only', error: error.message })); process.exitCode = 1; }
}
