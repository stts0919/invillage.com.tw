#!/usr/bin/env node
/**
 * P7-W1/W2：只讀既有 dist，產生原生 Designer 片段與明示整合契約。
 * node package-designer-pages.mjs --dist DIR --map FILE --out NEW_DIR
 * node package-designer-pages.mjs --dist DIR --inventory
 * Mapping: {schemaVersion:1,siteId:"65009115380adfba3ebe2328",
 *   assetUrls:{"/assets/...":"https://cdn.prod.website-files.com/..."},
 *   assetWidths:{"原始圖片URL":800}} // optional，實際target寬度，不是source descriptor。
 * fixtureOnly:true 只允許離線樣例；其產物不得匯入／發布。
 * 不抓網路、不重建、不寫入 Webflow、不覆寫既有輸出。
 */
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const SITE_ID = '65009115380adfba3ebe2328';
const LIMIT = 49_000; // UTF-16 長度，連包裝標記一起計算；嚴格低於 50,000。
const ROUTES = new Map([
  ['index', '/'], ['spaces', '/spaces'], ['plan', '/plan'],
  ['about', '/about'], ['contact', '/contact'], ['404', '/404'],
]);
const VOID = new Set('area base br col embed hr img input link meta param source track wbr'.split(' '));
const RAW = new Set(['script', 'style']);
const HELD_GALLERY_ASSETS = new Set(['651d4f6f5a6041010d0df333', '651ec6d7132a2cfb80d4309e']);
const fail = (message) => { throw new Error(message); };
const hash = (value) => createHash('sha256').update(value).digest('hex');
const escape = (value) => String(value).replaceAll('&', '&amp;').replaceAll('"', '&quot;').replaceAll('<', '&lt;');
const decode = (value) => value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt);/gi, (_, entity) => {
  if (entity[0] === '#') {
    const number = entity[1].toLowerCase() === 'x' ? parseInt(entity.slice(2), 16) : Number(entity.slice(1));
    if (!Number.isInteger(number) || number < 0 || number > 0x10ffff) fail('Invalid HTML character reference');
    return String.fromCodePoint(number);
  }
  return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>' })[entity.toLowerCase()];
});
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const attrsOf = (node) => new Map(node.attrs ?? []);
const attr = (node, name) => attrsOf(node).get(name);
const hasClass = (node, name) => (attr(node, 'class') ?? '').split(/\s+/).includes(name);
const element = (tag, attrs = {}, children = []) => ({ tag, attrs: Object.entries(attrs), children });
const text = (value) => ({ text: value });

// 嚴格解析 Astro 已輸出的平衡標記；不猜測瀏覽器隱式補齊／錯誤修復。
export function parseHtml(source) {
  const root = element('#document');
  const stack = [root];
  let index = 0;
  while (index < source.length) {
    if (source.startsWith('<!--', index)) {
      const end = source.indexOf('-->', index + 4);
      if (end < 0) fail('Unclosed HTML comment');
      index = end + 3;
      continue;
    }
    if (source[index] !== '<') {
      const end = source.indexOf('<', index);
      const stop = end < 0 ? source.length : end;
      stack.at(-1).children.push(text(source.slice(index, stop)));
      index = stop;
      continue;
    }
    let end = index + 1;
    let quote = null;
    for (; end < source.length; end++) {
      const char = source[end];
      if (quote) { if (char === quote) quote = null; }
      else if (char === '"' || char === "'") quote = char;
      else if (char === '>') break;
    }
    if (end === source.length) fail('Unclosed HTML tag');
    const token = source.slice(index, end + 1);
    index = end + 1;
    if (/^<!doctype\s/i.test(token)) continue;
    const closing = /^<\/([\w:-]+)\s*>$/.exec(token);
    if (closing) {
      if (stack.length === 1 || stack.at(-1).tag !== closing[1].toLowerCase()) fail(`Unbalanced closing tag: ${closing[1]}`);
      stack.pop();
      continue;
    }
    const opening = /^<([\w:-]+)([\s\S]*?)\/?\s*>$/.exec(token);
    if (!opening) fail(`Unsupported HTML token: ${token.slice(0, 50)}`);
    const node = element(opening[1].toLowerCase());
    let rest = opening[2];
    while (rest.trim()) {
      const match = /^\s+([^\s"'<>\/=]+)(?:\s*=\s*(?:"([^"]*)"|'([^']*)'|([^\s"'=<>`]+)))?/.exec(rest);
      if (!match) fail(`Unsupported attribute syntax on <${node.tag}>`);
      const name = match[1].toLowerCase();
      if (node.attrs.some(([key]) => key === name)) fail(`Duplicate ${name} attribute`);
      node.attrs.push([name, match[2] !== undefined || match[3] !== undefined || match[4] !== undefined
        ? decode(match[2] ?? match[3] ?? match[4]) : null]);
      rest = rest.slice(match[0].length);
    }
    stack.at(-1).children.push(node);
    if (RAW.has(node.tag)) {
      const close = new RegExp(`</${node.tag}\\s*>`, 'gi');
      close.lastIndex = index;
      const match = close.exec(source);
      if (!match) fail(`Unclosed ${node.tag}`);
      node.children.push(text(source.slice(index, match.index)));
      index = close.lastIndex;
    } else if (!VOID.has(node.tag) && !/\/\s*>$/.test(token)) stack.push(node);
  }
  if (stack.length !== 1) fail(`Unclosed ${stack.at(-1).tag}`);
  return root;
}

export function serialize(node) {
  if (node.text !== undefined) return node.text;
  if (node.tag === '#document') return node.children.map(serialize).join('');
  const attributes = node.attrs.map(([name, value]) => value === null ? ` ${name}` : ` ${name}="${escape(value)}"`).join('');
  const open = `<${node.tag}${attributes}>`;
  return VOID.has(node.tag) ? open : `${open}${node.children.map(serialize).join('')}</${node.tag}>`;
}
const walk = (node, visitor) => {
  if (node.tag) visitor(node);
  for (const child of node.children ?? []) walk(child, visitor);
};
const findAll = (node, predicate) => { const found = []; walk(node, (item) => { if (predicate(item)) found.push(item); }); return found; };
const one = (nodes, label) => { if (nodes.length !== 1) fail(`Expected one ${label}, got ${nodes.length}`); return nodes[0]; };
const copyText = (node) => node.text !== undefined ? node.text : RAW.has(node.tag) ? '' : node.children.map(copyText).join('');

function readRegular(root, name, fingerprints) {
  if (name.includes('\\') || /[?#\0]/.test(name)) fail(`Unsafe local asset path: ${name}`);
  const path = resolve(root, name);
  if (!inside(root, path)) fail('Input path escapes dist');
  let cursor = root;
  for (const part of relative(root, path).split(sep)) {
    cursor = join(cursor, part);
    if (lstatSync(cursor).isSymbolicLink()) fail('Input symlink is not allowed');
  }
  if (!lstatSync(path).isFile()) fail(`Input is not a regular file: ${name}`);
  const buffer = readFileSync(path);
  fingerprints.set(name, { path: name, bytes: buffer.length, sha256: hash(buffer) });
  return buffer;
}

function loadDist(directory) {
  if (lstatSync(directory).isSymbolicLink() || !lstatSync(directory).isDirectory()) fail('dist must be a regular directory');
  const root = realpathSync(directory);
  const fingerprints = new Map();
  const pages = new Map();
  const css = new Map();
  for (const [slug, route] of ROUTES) {
    const source = readRegular(root, `${slug}.html`, fingerprints).toString('utf8');
    const document = parseHtml(source);
    const body = one(findAll(document, (node) => node.tag === 'body'), `${route} body`);
    const head = one(findAll(document, (node) => node.tag === 'head'), `${route} head`);
    const sheets = findAll(head, (node) => node.tag === 'link' && attr(node, 'rel') === 'stylesheet').map((node) => attr(node, 'href'));
    for (const href of sheets) {
      if (!/^\/_astro\/[\w.-]+\.css$/.test(href)) fail('Unexpected stylesheet URL');
      if (!css.has(href)) css.set(href, readRegular(root, href.slice(1), fingerprints).toString('utf8'));
    }
    pages.set(slug, { route, document, body, head, sheets });
  }
  if (css.size !== 2) fail(`Expected main and secondary CSS, got ${css.size}`);
  return { root, fingerprints, pages, css };
}

function isMediaReference(value) {
  return /^(?:\/assets\/|\/_astro\/|https?:\/\/|\/\/)/.test(value);
}
function targetUrl(value, fixtureOnly) {
  let url;
  try { url = new URL(value); } catch { fail('Mapping target must be an absolute HTTPS asset URL'); }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) fail('Unsafe mapping target URL');
  const approved = ['cdn.prod.website-files.com', 'assets-global.website-files.com', 'assets.website-files.com', 'uploads-ssl.webflow.com'];
  const libraryPrefix = `/webflow-prod-assets/${SITE_ID}/`;
  let hostedLibraryAsset = false;
  if (url.hostname === 's3.amazonaws.com' && url.pathname.startsWith(libraryPrefix)) {
    let filename;
    try { filename = decodeURIComponent(url.pathname.slice(libraryPrefix.length)); }
    catch { fail('Invalid hosted library filename encoding'); }
    hostedLibraryAsset = filename.length > 0 && !/[/\\\x00-\x1f\x7f]/.test(filename)
      && filename !== '.' && filename !== '..';
  }
  if (!approved.includes(url.hostname) && !hostedLibraryAsset && !(fixtureOnly && url.hostname === 'designer-fixture.invalid')) fail(`Unapproved target asset host/path: ${url.hostname}`);
  if (url.pathname === '/') fail('Mapping target must include an asset path');
  return url.href;
}
function mappingFrom(path) {
  const buffer = readFileSync(path);
  const map = JSON.parse(buffer);
  if (map.schemaVersion !== 1 || map.siteId !== SITE_ID || !map.assetUrls || typeof map.assetUrls !== 'object' || Array.isArray(map.assetUrls)) fail('Invalid mapping schema/siteId/assetUrls');
  if (map.fixtureOnly !== undefined && typeof map.fixtureOnly !== 'boolean') fail('fixtureOnly must be boolean');
  for (const key of Object.keys(map)) if (!['schemaVersion', 'siteId', 'assetUrls', 'assetWidths', 'fixtureOnly'].includes(key)) fail(`Unknown mapping field: ${key}`);
  const urls = new Map();
  for (const [source, target] of Object.entries(map.assetUrls)) {
    if (typeof target !== 'string' || !isMediaReference(source)) fail('Invalid mapping entry');
    urls.set(source, targetUrl(target, map.fixtureOnly === true));
  }
  const widths = new Map();
  const targetWidths = new Map();
  if (map.assetWidths !== undefined) {
    if (!map.assetWidths || typeof map.assetWidths !== 'object' || Array.isArray(map.assetWidths)) fail('assetWidths must be an object');
    for (const [source, width] of Object.entries(map.assetWidths)) {
      if (!urls.has(source)) fail('assetWidths key is missing its assetUrls mapping');
      if (!Number.isSafeInteger(width) || width <= 0) fail('assetWidths values must be positive safe integers');
      const target = urls.get(source);
      if (targetWidths.has(target) && targetWidths.get(target) !== width) fail('Conflicting actual widths for the same target URL');
      widths.set(source, width); targetWidths.set(target, width);
    }
  }
  return { urls, widths, targetWidths, hasWidthMetadata: map.assetWidths !== undefined,
    fixtureOnly: map.fixtureOnly === true, sha256: hash(buffer) };
}

function unpackAstro(value) {
  if (!Array.isArray(value) || value.length !== 2 || ![0, 1].includes(value[0])) fail('Unsupported Astro props encoding');
  const [type, data] = value;
  if (type === 1) return data.map(unpackAstro);
  if (data && typeof data === 'object') return Object.fromEntries(Object.entries(data).map(([key, item]) => [key, unpackAstro(item)]));
  return data;
}
function islandData(island) {
  const encoded = JSON.parse(attr(island, 'props'));
  return Object.fromEntries(Object.entries(encoded).map(([key, value]) => [key, unpackAstro(value)]));
}

// 只做詞法前綴／URL替換，原有規則次序、keyframes與自訂breakpoints完整保留。
function cssTransform(source, reference, names) {
  if (/@import\b/i.test(source)) fail('External CSS imports are not allowed in the packaged head');
  let result = '';
  for (let index = 0; index < source.length;) {
    if (source.startsWith('/*', index)) {
      const end = source.indexOf('*/', index + 2);
      if (end < 0) fail('Unclosed CSS comment');
      result += source.slice(index, end + 2); index = end + 2; continue;
    }
    const url = /^url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s]*))\s*\)/i.exec(source.slice(index));
    if (url) { result += `url("${reference(url[1] ?? url[2] ?? url[3])}")`; index += url[0].length; continue; }
    if (source[index] === '"' || source[index] === "'") {
      const quote = source[index]; let end = index + 1;
      for (; end < source.length; end++) {
        if (source[end] === '\\') end++;
        else if (source[end] === quote) break;
      }
      if (end === source.length) fail('Unclosed CSS string');
      const value = source.slice(index + 1, end);
      if (/^(?:\/|\.\.?\/|https?:\/\/)/.test(value)) {
        if (value.includes('\\')) fail('Escaped CSS asset strings need an explicit adapter');
        result += `"${reference(value)}"`;
      } else result += source.slice(index, end + 1);
      index = end + 1; continue;
    }
    const variable = /^--[a-zA-Z_][\w-]*/.exec(source.slice(index));
    if (variable) {
      const old = variable[0]; const next = `--iv1-${old.slice(2)}`;
      names.variables[old] = next; result += next; index += old.length; continue;
    }
    const className = /^\.([a-zA-Z_][\w-]*)/.exec(source.slice(index));
    if (className) {
      const old = className[1]; const next = `iv1-${old}`;
      names.classes[old] = next; result += `.${next}`; index += className[0].length; continue;
    }
    result += source[index++];
  }
  // Full, lossless body-font conversion changes only the container format.
  result = result.replace(/(url\("[^"\n]+\.woff2"\)\s*)format\("truetype"\)/g, '$1format("woff2")');
  if (/<\/style/i.test(result)) fail('CSS contains an unsafe style closing tag');
  return result;
}

function setupReferences(dist, mapping) {
  const references = new Map();
  function reference(source) {
    if (/^data:image\/(?:svg\+xml|png|jpeg|webp);/i.test(source)) return source;
    if (source.startsWith('#')) return source;
    if (!isMediaReference(source)) fail(`Unknown media reference: ${source.slice(0, 80)}`);
    if (source.startsWith('/') && !source.startsWith('//')) {
      if (!/^\/(?:assets|_astro)\//.test(source)) fail(`Unknown local media path: ${source}`);
      readRegular(dist.root, source.slice(1), dist.fingerprints);
    }
    references.set(source, (references.get(source) ?? 0) + 1);
    if (!mapping) return source;
    if (!mapping.urls.has(source)) fail(`Missing exact asset mapping: ${source}`);
    return mapping.urls.get(source);
  }
  reference.targetWidth = (source) => {
    if (!mapping?.hasWidthMetadata) return undefined;
    // 本機small別名可指向同一已核target；只從相同target URL的明示尺寸推導，不能猜sourceWidth。
    const width = mapping.widths.get(source) ?? mapping.targetWidths.get(mapping.urls.get(source));
    if (width === undefined) fail(`Missing actual target width for image URL: ${source}`);
    return width;
  };
  return { reference, references };
}

function mapObject(value, reference) {
  if (typeof value === 'string' && isMediaReference(value)) return reference(value);
  if (Array.isArray(value)) return value.map((item) => mapObject(item, reference));
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, mapObject(item, reference)]));
  return value;
}
function srcset(value, reference) {
  const descriptors = new Set();
  return value.split(',').map((entry) => {
    const match = /^\s*(\S+)(?:\s+(\d+(?:\.\d+)?[wx]))?\s*$/.exec(entry);
    if (!match) fail('Unsupported srcset syntax');
    let descriptor = match[2];
    if (descriptor?.endsWith('w')) {
      const width = reference.targetWidth(match[1]) ?? Number(descriptor.slice(0, -1));
      if (!Number.isSafeInteger(width) || width <= 0) fail('Invalid srcset width descriptor');
      descriptor = `${width}w`;
    }
    if (descriptor && descriptors.has(descriptor)) fail('Duplicate target srcset descriptor');
    if (descriptor) descriptors.add(descriptor);
    return `${reference(match[1])}${descriptor ? ` ${descriptor}` : ''}`;
  }).join(', ');
}
function rewriteTree(node, reference, names) {
  if (!node.tag) return { ...node };
  const attrs = node.attrs.map(([name, value]) => {
    if (/^on/i.test(name)) fail(`Inline event handler on <${node.tag}>`);
    if (value === null) return [name, value];
    if (['src', 'poster'].includes(name)) value = reference(value);
    if (name === 'srcset') value = srcset(value, reference);
    if (name === 'href') {
      if (/^\/(?:assets|_astro)\//.test(value) || /^https?:\/\/.*(?:r2\.dev|\.webflow\.io|\.pages\.dev)/i.test(value)) value = reference(value);
      else if (value.startsWith('/') && !value.startsWith('//')) {
        if (![...ROUTES.values()].includes(value.split(/[?#]/)[0])) fail(`Unknown local navigation route: ${value}`);
      } else if (!/^(?:#|https:\/\/|mailto:|tel:)/.test(value)) fail(`Unsupported navigation URL: ${value}`);
    }
    if (!['href', 'src', 'srcset', 'poster', 'style', 'xmlns', 'xmlns:xlink'].includes(name) && /^(?:\/|\.\.?\/|https?:\/\/)/.test(value)) {
      if (!(name === 'data-iv1-route' && [...ROUTES.values()].includes(value))) value = reference(value);
    }
    if (name === 'class') value = value.split(/\s+/).filter(Boolean).map((old) => {
      if (!/^[a-zA-Z_][\w-]*$/.test(old)) fail(`Unsupported class token: ${old}`);
      names.classes[old] = `iv1-${old}`; return names.classes[old];
    }).join(' ');
    if (name === 'style') value = cssTransform(value, reference, names);
    return [name, value];
  });
  return { ...node, attrs, children: node.children.map((child) => rewriteTree(child, reference, names)) };
}

function cleanTree(node) {
  if (!node.tag) return { ...node };
  if (node.tag === 'script' || node.tag === 'style') return null;
  return { ...node, attrs: [...node.attrs], children: node.children.map(cleanTree).filter(Boolean) };
}
function inventoryScan(dist) {
  const { reference, references } = setupReferences(dist, null);
  const names = { classes: {}, variables: {} };
  for (const source of dist.css.values()) cssTransform(source, reference, names);
  for (const { body } of dist.pages.values()) {
    const islands = findAll(body, (node) => node.tag === 'astro-island');
    for (const island of islands) mapObject(islandData(island), reference);
    const scan = cleanTree(body);
    function removeIslands(node) { node.children = node.children.filter((item) => item.tag !== 'astro-island'); node.children.forEach((item) => { if (item.children) removeIslands(item); }); }
    removeIslands(scan);
    rewriteTree(scan, reference, names);
    for (const style of findAll(body, (node) => node.tag === 'style')) cssTransform(style.children.map(copyText).join(''), reference, names);
  }
  return { schemaVersion: 1, siteId: SITE_ID, requiredAssetUrls: [...references.keys()].sort(),
    inputFingerprints: [...dist.fingerprints.values()].sort((a, b) => a.path.localeCompare(b.path)) };
}
export function inventoryDesignerInputs(directory) { return inventoryScan(loadDist(directory)); }

function validateNative(html, label) {
  const tree = parseHtml(html);
  const roots = tree.children.filter((node) => node.tag || node.text.trim());
  if (roots.length !== 1 || !roots[0].tag) fail(`${label} must have one element root`);
  const forbidden = findAll(tree, (node) => ['html', 'head', 'body', 'script', 'style', 'astro-island', 'iframe'].includes(node.tag));
  if (forbidden.length) fail(`${label} contains forbidden native tags`);
  if (/\b(?:r2\.dev|pages\.dev|webflow\.io)\b|\/_astro\/|\/assets\//i.test(html.replace(/https:\/\/[^\s"<>]+/g, (url) => {
    // 已核准 HTTPS URL 的 pathname 可包含 /assets/；仍檢查平台host。
    const parsed = new URL(decode(url)); return parsed.hostname;
  }))) fail(`${label} retains a source-only asset URL`);
  return tree;
}

export function packageDesignerPages({ dist: directory, map: mapPath, out }) {
  const dist = loadDist(directory);
  const mapping = mappingFrom(mapPath);
  const output = resolve(out);
  if (output === dist.root || inside(dist.root, output) || inside(output, dist.root)) fail('Output overlaps dist');
  if (!lstatSync(dirname(output)).isDirectory()) fail('Output parent must already exist');
  try { lstatSync(output); fail('Output already exists; refusing to overwrite'); } catch (error) { if (error.code !== 'ENOENT') throw error; }
  const { reference, references } = setupReferences(dist, mapping);
  const names = { classes: {}, variables: {} };
  const files = new Map();
  const records = [];
  const add = (path, content, info = {}) => {
    if (files.has(path)) fail(`Duplicate output path: ${path}`);
    if (content.length >= LIMIT) fail(`${path} exceeds fragment limit; split by complete blocks`);
    files.set(path, content);
    records.push({ path, characters: content.length, unicodeCharacters: [...content].length, bytes: Buffer.byteLength(content), sha256: hash(content), ...info });
  };
  const styleFile = (path, source, info = {}) => {
    const css = cssTransform(source, reference, names);
    add(path, `<style>${css}</style>`, { kind: 'head-style', cssCharacters: css.length, ...info });
  };
  const mainCss = one([...dist.css].filter(([name]) => /\/SiteLayout\./.test(name)), 'main CSS');
  const secondaryCss = one([...dist.css].filter(([name]) => /\/secondary-pages\./.test(name)), 'secondary CSS');
  styleFile('head/common-style.html', mainCss[1], { placement: 'site-head-after-migration' });
  styleFile('head/secondary-style.html', secondaryCss[1], { placement: 'plan/about/contact-page-head' });
  const routeRecords = [];
  let commonFooter = null;
  let commonHeader = null;
  let commonNojs = null;
  for (const [slug, page] of dist.pages) {
    const body = structuredClone(page.body);
    const header = one(findAll(body, (node) => node.tag === 'header'), `${slug} header`);
    const footer = one(findAll(body, (node) => node.tag === 'footer'), `${slug} footer`);
    const skip = one(findAll(body, (node) => hasClass(node, 'skip-link')), `${slug} skip link`);
    const main = one(findAll(body, (node) => node.tag === 'main'), `${slug} main`);
    const wrapper = one(findAll(body, (node) => attr(node, 'id') === 'smooth-wrapper'), 'smooth-wrapper');
    const content = one(findAll(wrapper, (node) => attr(node, 'id') === 'smooth-content'), 'smooth-content');
    if (!content.children.includes(main) || !content.children.includes(footer) || wrapper.children.length !== 1) fail('Unexpected page-layer smoother structure');
    const headerNormalized = structuredClone(header);
    headerNormalized.attrs = headerNormalized.attrs.filter(([name]) => name !== 'data-scrolled');
    walk(headerNormalized, (node) => { node.attrs = node.attrs.filter(([name]) => name !== 'aria-current'); });
    const signature = serialize(headerNormalized);
    if (commonHeader && commonHeader !== signature) fail('Shared header varies beyond active-route/onHero state');
    commonHeader = signature;
    const footerSignature = serialize(footer);
    if (commonFooter && commonFooter !== footerSignature) fail('Shared footer is inconsistent');
    commonFooter = footerSignature;
    const nojs = findAll(body, (node) => node.tag === 'noscript');
    const headerNojs = one(nojs.filter((node) => !findAll(node, (item) => hasClass(item, 'spaces-fallback')).length), 'header noJS');
    const nojsStyle = one(findAll(headerNojs, (node) => node.tag === 'style'), 'header noJS style').children.map(copyText).join('');
    if (commonNojs && commonNojs !== nojsStyle) fail('Header noJS CSS varies across routes');
    commonNojs = nojsStyle;
    const integrations = [];
    let fallback = null;
    const islands = findAll(body, (node) => node.tag === 'astro-island');
    if (slug === 'spaces') {
      const island = one(islands, 'SpacesExplorer island');
      if (!/\/SpacesExplorer\.[\w-]+\.js$/.test(attr(island, 'component-url') ?? '')) fail('Unexpected island component');
      const sourceData = islandData(island);
      const data = mapObject(sourceData, reference);
      if (data.rooms?.length !== 6 || data.sharedSpaces?.length !== 10) fail('Spaces data must retain 6 rooms/10 public spaces');
      const photos = [...data.sharedSpaces, ...data.rooms].reduce((sum, item) => sum + item.gallery.length, 0);
      if (photos !== 78) fail('Spaces data must retain 78 photo positions');
      const sourceItems = [...sourceData.sharedSpaces, ...sourceData.rooms];
      const sourcePhotoIds = sourceItems.flatMap((item) => item.gallery.map((photo) => photo.assetId));
      if (new Set(sourcePhotoIds).size !== 77 || sourcePhotoIds.some((id) => HELD_GALLERY_ASSETS.has(id))) fail('Gallery unique asset/hold contract failed');
      if (mapping.hasWidthMetadata) {
        [...data.sharedSpaces, ...data.rooms].forEach((item, itemIndex) => {
          const original = sourceItems[itemIndex];
          item.media.widths = Object.fromEntries(['small', 'medium', 'large'].map((role) => [role, reference.targetWidth(original.media[role])]));
          const stageWidths = ['small', 'medium', 'large'].map((role) => item.media.widths[role]);
          if (new Set(stageWidths).size !== stageWidths.length) fail('Target stage widths must remain distinct');
          item.gallery.forEach((photo, photoIndex) => {
            photo.variants.forEach((variant, variantIndex) => {
              variant.width = reference.targetWidth(original.gallery[photoIndex].variants[variantIndex].url);
            });
            if (new Set(photo.variants.map((variant) => variant.width)).size !== photo.variants.length) fail('Target gallery widths must remain distinct');
          });
        });
      }
      const componentJson = JSON.stringify({ schemaVersion: 1, renderNativeH1: false, ...data }, null, 2) + '\n';
      // JSON不是Embed，不套50k HTML欄位上限。
      files.set('components/spaces-data.json', componentJson);
      records.push({ path: 'components/spaces-data.json', kind: 'code-component-data', characters: componentJson.length, bytes: Buffer.byteLength(componentJson), sha256: hash(componentJson), photoPositions: photos });
      const h1 = structuredClone(one(findAll(island, (node) => node.tag === 'h1'), 'Spaces native H1'));
      const shell = element('section', { class: 'spaces-immersive', 'aria-labelledby': attr(h1, 'id') }, [
        element('div', { class: 'spaces-stage' }, [
          element('div', { class: 'spaces-stage-top' }, [h1]),
          element('div', { 'data-iv1-code-component-slot': 'SpacesExplorer', 'data-iv1-native-title-id': attr(h1, 'id') }),
        ]),
      ]);
      main.children = main.children.map((node) => node === island ? shell : node);
      integrations.push({ component: 'SpacesExplorer', selector: '[data-iv1-code-component-slot="SpacesExplorer"]',
        data: 'components/spaces-data.json', nativeH1: attr(h1, 'id'), renderComponentH1: false,
        note: '原生H1／stage wrapper由頁面持有；工程B需對齊Shadow DOM與stage布局，不能把原完整Astro/React外框再次巢狀插入。' });
      const fallbackNoscript = one(nojs.filter((node) => findAll(node, (item) => hasClass(item, 'spaces-fallback')).length), 'spaces noJS fallback');
      const section = one(findAll(fallbackNoscript, (node) => hasClass(node, 'spaces-fallback')), 'fallback section');
      const articles = findAll(section, (node) => node.tag === 'article');
      const images = findAll(section, (node) => node.tag === 'img');
      if (articles.length !== 16 || images.length !== 78 || findAll(section, (node) => node.tag === 'h1').length) fail('Fallback must retain 16 articles/78 images/no H1');
      const fallbackPhotoIds = findAll(section, (node) => node.tag === 'a' && attr(node, 'data-gallery-asset-id') !== undefined).map((node) => attr(node, 'data-gallery-asset-id'));
      if (JSON.stringify(fallbackPhotoIds) !== JSON.stringify(sourcePhotoIds)) fail('Fallback gallery membership/order differs from component source');
      const fallbackCss = one(findAll(fallbackNoscript, (node) => node.tag === 'style'), 'fallback noJS style').children.map(copyText).join('');
      const css = cssTransform(fallbackCss, reference, names);
      add('head/spaces-nojs.html', `<noscript><style>${css}</style></noscript>`, { kind: 'head-noscript', cssCharacters: css.length });
      const mappedSection = rewriteTree(section, reference, names);
      const chunks = [];
      let children = [];
      const wrap = (items) => element('noscript', {}, [{ ...mappedSection, children: items }]);
      // 將分類標題跟第一篇文章放同一完整區塊，避免跨Embed後標題孤立。
      const blocks = [];
      let heading = [];
      for (const child of mappedSection.children) {
        if (child.tag === 'h2' || (child.text !== undefined && !child.text.trim())) heading.push(child);
        else {
          if (child.tag !== 'article') fail('Unexpected fallback child; only complete heading/article blocks are supported');
          blocks.push([...heading, child]); heading = [];
        }
      }
      if (heading.some((node) => node.tag)) fail('Fallback has a trailing heading without an article');
      for (const block of blocks) {
        if (serialize(wrap([...children, ...block])).length >= LIMIT) {
          if (!children.some((node) => node.tag === 'article')) fail('One complete fallback block exceeds limit');
          chunks.push(wrap(children)); children = [];
        }
        if (serialize(wrap(block)).length >= LIMIT) fail('One complete fallback article exceeds limit');
        children.push(...block);
      }
      if (children.length) chunks.push(wrap(children));
      const outputArticles = chunks.flatMap((chunk) => findAll(chunk, (node) => node.tag === 'article'));
      const outputImages = chunks.flatMap((chunk) => findAll(chunk, (node) => node.tag === 'img'));
      const sourceTexts = articles.map(copyText).join('\n');
      const outputTexts = outputArticles.map(copyText).join('\n');
      const sourceAlts = images.map((node) => attr(node, 'alt')).join('\n');
      const outputAlts = outputImages.map((node) => attr(node, 'alt')).join('\n');
      if (sourceTexts !== outputTexts || sourceAlts !== outputAlts || outputArticles.length !== 16 || outputImages.length !== 78) fail('Fallback splitting changed content or alt order');
      const slots = chunks.map((chunk, index) => {
        const number = String(index + 1).padStart(2, '0');
        const path = `embeds/spaces-fallback-${number}.html`;
        const html = serialize(chunk); validateNative(html, path);
        add(path, html, { kind: 'noscript-embed', route: page.route,
          articles: findAll(chunk, (node) => node.tag === 'article').length,
          images: findAll(chunk, (node) => node.tag === 'img').length });
        return element('div', { 'data-iv1-embed-slot': path });
      });
      main.children = main.children.flatMap((node) => node === fallbackNoscript ? slots : [node]);
      fallback = { articles: 16, images: 78, uniqueAssets: 77, heldAssetsIncluded: 0, chunks: chunks.length, orderedArticleTextSha256: hash(sourceTexts),
        outputArticleTextSha256: hash(outputTexts), orderedImageAltsSha256: hash(sourceAlts), outputImageAltsSha256: hash(outputAlts) };
    } else if (islands.length) fail(`Unexpected island on ${slug}`);
    const pageRoot = element('div', { class: 'designer-page', 'data-iv1-route': page.route }, [skip, header, wrapper]);
    const expected = cleanTree(pageRoot);
    const rewritten = rewriteTree(expected, reference, names);
    const html = serialize(rewritten);
    const checked = validateNative(html, `${slug} native`);
    if (copyText(checked) !== copyText(expected)) fail(`${slug} native text changed`);
    const headings = findAll(checked, (node) => node.tag === 'h1');
    if (headings.length !== 1) fail(`${slug} must retain exactly one native H1`);
    const ctas = findAll(checked, (node) => hasClass(node, 'iv1-primary-cta'));
    if (ctas.length !== (slug === '404' ? 0 : 1) || ctas.some((node) => attr(node, 'href') !== 'https://m.me/invillagewulai')) fail(`${slug} CTA contract failed`);
    const ids = findAll(checked, (node) => attr(node, 'id') !== undefined).map((node) => attr(node, 'id'));
    if (new Set(ids).size !== ids.length) fail(`${slug} duplicate native ID`);
    const details = findAll(checked, (node) => node.tag === 'details');
    if (slug === 'plan' && (details.length !== 6 || details.some((node) => attr(node, 'name') !== 'plan-group'))) fail('plan-group contract failed');
    const nearby = findAll(checked, (node) => hasClass(node, 'iv1-secondary-nearby-card'));
    if (slug === 'about' && (nearby.length !== 10 || !findAll(checked, (node) => attr(node, 'id') === 'about-iot-heading').length)) fail('About ten-card/IoT contract failed');
    add(`pages/${slug}.html`, html, { kind: 'native-page', route: page.route, nativeH1: 1, ctas: ctas.length });
    const headerHtml = serialize(rewriteTree(element('div', { class: 'designer-header' }, [skip, header]), reference, names));
    add(`shared/header-${slug}.html`, headerHtml, { kind: 'shared-header-variant', route: page.route });
    routeRecords.push({ slug, route: page.route, native: `pages/${slug}.html`, header: `shared/header-${slug}.html`, footer: 'shared/footer.html',
      head: ['head/common-style.html', ...(page.sheets.includes(secondaryCss[0]) ? ['head/secondary-style.html'] : []),
        'head/header-nojs.html', ...(slug === 'spaces' ? ['head/spaces-nojs.html'] : [])],
      title: copyText(one(findAll(page.head, (node) => node.tag === 'title'), 'page title')),
      sourceCopySha256: hash(copyText(expected)), nativeCopySha256: hash(copyText(checked)),
      nativeH1: copyText(headings[0]), ids, planGroupDetails: slug === 'plan' ? details.length : null,
      aboutCards: slug === 'about' ? nearby.length : null, fallback, integrations,
      utility404: slug === '404', metadataNotApplied: true });
  }
  add('shared/footer.html', serialize(rewriteTree(parseHtml(commonFooter).children[0], reference, names)), { kind: 'shared-footer' });
  const headerCss = cssTransform(commonNojs, reference, names);
  add('head/header-nojs.html', `<noscript><style>${headerCss}</style></noscript>`, { kind: 'head-noscript', cssCharacters: headerCss.length });
  const tagCounts = {};
  for (const [path, content] of files) if (path.endsWith('.html') && !path.startsWith('head/')) walk(parseHtml(content), (node) => {
    if (node.tag !== '#document') tagCounts[node.tag] = (tagCounts[node.tag] ?? 0) + 1;
  });
  // 輸出URL的機械核對不等於遠端資產存在、字型授權或Designer/WHTML支援證據。
  for (const [path, content] of files) {
    if (/\b(?:r2\.dev|pages\.dev|webflow\.io)\b/i.test(content)) fail(`${path} retains forbidden platform origin`);
    if (path.endsWith('.json')) for (const url of content.matchAll(/https:\/\/[^"\s]+/g)) targetUrl(url[0], mapping.fixtureOnly);
  }
  const manifest = {
    schemaVersion: 1, siteId: SITE_ID, fixtureOnly: mapping.fixtureOnly,
    importReady: false, mappingComplete: true, readyForImportTrial: !mapping.fixtureOnly,
    actualWidthMetadataProvided: mapping.hasWidthMetadata,
    remoteAssetsVerified: false, designerImportVerified: false,
    maxFragmentCharactersExclusive: LIMIT, inputMappingSha256: mapping.sha256,
    scriptSha256: hash(readFileSync(fileURLToPath(import.meta.url))),
    inputs: [...dist.fingerprints.values()].sort((a, b) => a.path.localeCompare(b.path)),
    routes: routeRecords, files: records, names, tagCounts,
    assetMappings: [...references].map(([source, usages]) => ({ sourceUrlSha256: hash(source), target: mapping.urls.get(source), usages,
      targetWidth: mapping.widths.get(source) ?? mapping.targetWidths.get(mapping.urls.get(source)) ?? null })),
    unusedMappingEntries: [...mapping.urls.keys()].filter((url) => !references.has(url)).map(hash),
    officialReferences: [
      'https://developers.webflow.com/mcp/tools/data-tools#data_whtml_builder',
      'https://help.webflow.com/hc/en-us/articles/33961332238611-Custom-code-embed',
    ],
    integrationNotes: [
      '一般HTML透過WHTML原生匯入；pages是單根完整結構，shared是可重用片段，不可把兩者同時疊加造成重複header/footer。',
      '保留smooth-wrapper/content ID與Header在wrapper外；外層新iv1-designer-page不應被GSAP設定transform。',
      '所有class/custom-property加iv1前綴，names提供逐項映射；motion/menu/Hero/DevLink適配需依此契約改selector，不在本包內執行。',
      '原minified CSS保留media query/keyframes；放head style，不塞WHTML css參數。common style包含全域reset，只在核准移植頁啟用，不能先污染未移植舊頁。',
      'common CSS與secondary/noJS CSS分放site/page head，各欄含既有custom code的總長必須另核<50000；不要全部串接單一head。',
      'noscript/style及fallback使用精確Embed/head code，data-iv1-embed-slot只替換一次；每塊完整article保留原順序、不重複H1。',
      'details/summary需WHTML實際試作custom-tag支援及name=plan-group/open保留；若不能原生匯入，逐完整details Embed，不能改成失去語意的div。',
      'picture/source/video及media/preload/muted/loop/playsinline、svg/path屬特殊tag，逐项確認WHTML支援；Hero供應與控制交工程B/主管整合。',
      'aria/data/id/tabindex/inline-style與SVG屬性必須完整讀回；原生字型由head font-face URL供應，名稱/字重不改。',
      'SpacesExplorer資料另附JSON，單一Code Component root，不含Astro hydration；原生H1已保留，component不得再輸出H1。',
      '提供assetWidths時，所有w descriptor與stage/gallery寬度都需有實際target尺寸；同target URL的別名可共用已明示尺寸，缺尺寸或相互矛盾時停止，不以舊sourceWidth假冒。未提供此可選欄位時維持原Astro尺寸契約。',
      '此包去除執行腳本，menu/Hero/GSAP須由工程B/主管接回；不能把靜態封裝驗證當功能/響應式/Shadow DOM驗收。',
      '404片段只能接原Utility 404，不能建立HTTP200的普通/404頁。title/SEO/noindex僅記來源，沒有套用正式metadata。',
      'WHTML官方工具只說明HTML/CSS片段插入，未提供本包各特殊tag的完整支援矩陣；須做真實匯入讀回，不預先宣稱全部原生可編。',
    ],
  };
  files.set('package-manifest.json', JSON.stringify(manifest, null, 2) + '\n');
  // 全部驗證通過才建立輸出；wx及non-recursive mkdir拒絕競態覆寫。
  mkdirSync(output);
  for (const [path, content] of files) {
    const directory = dirname(join(output, path));
    if (directory !== output) mkdirSync(directory, { recursive: true });
    writeFileSync(join(output, path), content, { flag: 'wx' });
  }
  for (const input of dist.fingerprints.values()) if (hash(readRegular(dist.root, input.path, new Map())) !== input.sha256) fail('Input changed during packaging');
  return { out: output, files: files.size, routes: routeRecords.length, assets: references.size,
    fallbackArticles: 16, fallbackImages: 78, fixtureOnly: mapping.fixtureOnly, manifestSha256: hash(files.get('package-manifest.json')) };
}

function main(argv) {
  const options = {};
  for (let index = 0; index < argv.length; index++) {
    const flag = argv[index];
    if (flag === '--help') {
      console.log('node package-designer-pages.mjs --dist DIR --map FILE --out NEW_DIR\nnode package-designer-pages.mjs --dist DIR --inventory\nMapping JSON: schemaVersion=1,siteId,assetUrls,optional assetWidths(sourceURL -> actual target positive integer width); fixtureOnly=true只供離線樣例。'); return;
    }
    if (!['--dist', '--map', '--out', '--inventory'].includes(flag) || options[flag.slice(2)] !== undefined) fail(`Unknown/duplicate argument: ${flag}`);
    if (flag === '--inventory') options.inventory = true;
    else {
      const value = argv[++index]; if (!value || value.startsWith('--')) fail(`Missing ${flag} value`);
      options[flag.slice(2)] = value;
    }
  }
  if (!options.dist) fail('--dist is required');
  if (options.inventory) {
    if (options.map || options.out) fail('--inventory cannot be combined with --map/--out');
    console.log(JSON.stringify(inventoryDesignerInputs(options.dist), null, 2)); return;
  }
  if (!options.map || !options.out) fail('--map and --out are required');
  console.log(JSON.stringify(packageDesignerPages(options), null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try { main(process.argv.slice(2)); }
  catch (error) { console.error(`Designer packaging failed: ${error.message}`); process.exitCode = 1; }
}
