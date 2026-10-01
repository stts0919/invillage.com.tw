#!/usr/bin/env node
/** 公開staging HTML的唯讀靜態檢查；不保存HTML、headers、cookies，不執行頁面JS。 */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync } from 'node:fs';
import { dirname, isAbsolute, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseHtml, serialize } from './package-designer-pages.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const ORIGINS = new Set(['https://invillage.webflow.io', 'https://www.invillage.com.tw']);
const ROUTES = new Set(['/', '/spaces', '/plan', '/about', '/contact', '/404']);
const RUNTIME_MARKER = 'data-invillage-page-runtime';
const SITE_ID = '65009115380adfba3ebe2328';
const MAX_HTML_BYTES = 2_000_000;
const HOLDS = new Set(['651d4f6f5a6041010d0df333', '651ec6d7132a2cfb80d4309e']);
const sha = (value) => createHash('sha256').update(value).digest('hex');
const check = (condition, message) => { if (!condition) throw new Error(message); };
const attr = (node, name) => new Map(node.attrs ?? []).get(name);
const hasClass = (node, name) => (attr(node, 'class') ?? '').split(/\s+/).includes(name);
const walk = (node, fn, native = false) => {
  if (native && ['code-island', 'template'].includes(node.tag)) return;
  if (node.tag) fn(node);
  for (const child of node.children ?? []) walk(child, fn, native);
};
const all = (node, predicate, native = false) => { const found = []; walk(node, (item) => { if (predicate(item)) found.push(item); }, native); return found; };
const one = (nodes, label) => { check(nodes.length === 1, `${label}: expected one, got ${nodes.length}`); return nodes[0]; };
const text = (node) => node.text !== undefined ? node.text : ['style', 'script'].includes(node.tag) ? '' : (node.children ?? []).map(text).join('');
const equal = (value, expected, label) => check(JSON.stringify(value) === JSON.stringify(expected), `${label}: package mismatch`);
const booleanAttribute = (node, name) => attr(node, name) !== undefined;
const blockTags = new Set('div main section article header footer nav p h1 h2 h3 h4 h5 h6 ul ol li dl dt dd address figure figcaption details summary table thead tbody tr th td'.split(' '));
function decodeText(value) {
  return value.replace(/&(#x[\da-f]+|#\d+|amp|quot|apos|lt|gt|nbsp|copy|ndash|mdash);/gi, (_, token) => {
    if (token[0] === '#') { const code = token[1].toLowerCase() === 'x' ? parseInt(token.slice(2), 16) : Number(token.slice(1)); check(Number.isInteger(code) && code >= 0 && code <= 0x10ffff, 'Invalid text entity'); return String.fromCodePoint(code); }
    return ({ amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: '\u00a0', copy: '©', ndash: '–', mdash: '—' })[token.toLowerCase()];
  });
}
function renderedText(node) {
  if (node.text !== undefined) return decodeText(node.text).replace(/[\t\n\r\f ]+/g, ' ');
  if (['style', 'script', 'noscript', 'code-island', 'template', 'svg'].includes(node.tag)) return '';
  if (node.tag === 'br') return '\n';
  const value = (node.children ?? []).map(renderedText).join('');
  return blockTags.has(node.tag) ? `\n${value}\n` : value;
}
const normalizedFrozenText = (node) => renderedText(node).replace(/ *\n */g, '\n').replace(/\n+/g, '\n').trim();
function nativeProjection(node) {
  if (!node.tag) return { ...node };
  if (['code-island', 'template', 'noscript', 'style', 'script'].includes(node.tag)) return null;
  return { ...node, children: (node.children ?? []).map(nativeProjection).filter(Boolean) };
}
function runtimeSourceContract() {
  const bytes = readFileSync(resolve(dirname(SCRIPT), '../designer/InvillagePageRuntime.tsx'));
  const source = bytes.toString('utf8');
  const observed = /return\s+<span\b[^>]*\s(data-(?:iv1-runtime|invillage-page-runtime))\s*\/?\s*>/.exec(source)?.[1] ?? null;
  const playIndex = source.indexOf('await heroVideo.play()');
  const heroBooleanRestoreBeforePlay = ['muted', 'defaultMuted', 'loop', 'playsInline'].every((name) => {
    const index = source.indexOf(`heroVideo.${name} = true;`); return index >= 0 && playIndex > index;
  });
  return { requiredMarker: RUNTIME_MARKER, observedMarker: observed, matches: observed === RUNTIME_MARKER, heroBooleanRestoreBeforePlay, sourceSha256: sha(bytes) };
}

function managedAssetKey(value) {
  let url; try { url = new URL(value); } catch { return null; }
  if (url.protocol !== 'https:' || url.username || url.password || url.port || url.search || url.hash) return null;
  let relative;
  if (url.hostname === 's3.amazonaws.com' && url.pathname.startsWith(`/webflow-prod-assets/${SITE_ID}/`)) relative = url.pathname.slice(`/webflow-prod-assets/${SITE_ID}/`.length);
  else if (url.hostname === 'cdn.prod.website-files.com' && url.pathname.startsWith(`/${SITE_ID}/`)) relative = url.pathname.slice(`/${SITE_ID}/`.length);
  else return null;
  try { relative = decodeURIComponent(relative); } catch { return null; }
  if (!relative || /[\\\x00-\x1f\x7f]/.test(relative) || relative.split('/').some((part) => !part || part === '.' || part === '..')) return null;
  const filename = relative.split('/').at(-1);
  const id = /^([a-f0-9]{24})[_-]/.exec(filename)?.[1];
  return id ? `${SITE_ID}/${id}/${relative}` : null;
}

function approvedUrl(value) {
  const url = new URL(value);
  check(ORIGINS.has(url.origin) && !url.username && !url.password && !url.search && !url.hash, '--url must use an exact approved staging/production HTTPS origin without credentials/query/fragment');
  return url;
}
function reference(packageDir, logicalRoute = '/spaces') {
  check(ROUTES.has(logicalRoute), 'Unsupported logical route');
  const root = resolve(packageDir);
  check(lstatSync(root).isDirectory() && !lstatSync(root).isSymbolicLink() && realpathSync(root) === root, 'Package directory must be regular, without symlinks');
  function read(name) {
    check(typeof name === 'string' && !isAbsolute(name) && !/[\\\0?#]/.test(name), 'Unsafe package path');
    const parts = name.split('/'); check(parts.every((part) => part && part !== '.' && part !== '..'), 'Unsafe package path');
    let path = root;
    for (const part of parts) { path = join(path, part); check(!lstatSync(path).isSymbolicLink(), 'Package symlink is not allowed'); }
    check(lstatSync(path).isFile(), 'Package input is not a regular file'); return readFileSync(path);
  }
  const manifestBytes = read('package-manifest.json'); const manifest = JSON.parse(manifestBytes);
  check(manifest.schemaVersion === 1 && manifest.siteId === SITE_ID && manifest.fixtureOnly === false && manifest.mappingComplete === true, 'Package manifest is not the original mapped site');
  function fragment(name) {
    const row = one(manifest.files.filter((item) => item.path === name), 'Package file record');
    const bytes = read(name); const content = bytes.toString('utf8');
    check(sha(bytes) === row.sha256 && bytes.length === row.bytes && content.length === row.characters, `Package fingerprint mismatch: ${name}`);
    return { row, content, tree: name.endsWith('.html') ? parseHtml(content) : null };
  }
  const route = one(manifest.routes.filter((row) => row.route === logicalRoute), 'Package logical route');
  const page = fragment(route.native);
  const embeds = logicalRoute === '/spaces' ? manifest.files.filter((row) => row.kind === 'noscript-embed' && row.route === '/spaces').map((row) => fragment(row.path)) : [];
  if (logicalRoute === '/spaces') check(embeds.length === 2, 'Package must have two spaces fallback embeds');
  const data = logicalRoute === '/spaces' ? JSON.parse(fragment(one(route.integrations.filter((row) => row.component === 'SpacesExplorer'), 'Package Spaces integration').data).content) : null;
  const targets = new Set(manifest.assetMappings.map((row) => row.target));
  const widths = new Map();
  const assetFiles = new Map();
  for (const row of manifest.assetMappings) {
    const key = managedAssetKey(row.target);
    if (key) {
      const previous = assetFiles.get(key); const width = row.targetWidth ?? null;
      check(!previous || previous.width === width || previous.width === null || width === null, 'Conflicting managed filename/width');
      assetFiles.set(key, { width: width ?? previous?.width ?? null });
    }
  }
  for (const row of manifest.assetMappings) if (row.targetWidth !== null && row.targetWidth !== undefined) {
    check(Number.isSafeInteger(row.targetWidth) && row.targetWidth > 0 && (!widths.has(row.target) || widths.get(row.target) === row.targetWidth), 'Invalid package target width'); widths.set(row.target, row.targetWidth);
  }
  const runtimeContract = runtimeSourceContract(); check(runtimeContract.matches, 'Runtime source marker differs from required actual-source contract');
  return { manifest, route, page, embeds, data, targets, widths, assetFiles, manifestSha256: sha(manifestBytes), runtimeSourceContract: runtimeContract };
}

function sameManagedAsset(actual, expected, source) {
  if (actual === expected) return source.targets.has(expected);
  const actualKey = managedAssetKey(actual); const expectedKey = managedAssetKey(expected);
  return actualKey !== null && actualKey === expectedKey && source.assetFiles.has(actualKey) && source.targets.has(expected);
}

function forbiddenOrigin(value) {
  const url = new URL(value);
  check(url.protocol === 'https:' && !url.username && !url.password && !url.port, 'Necessary reference must use public HTTPS');
  check(!/(?:^|\.)(?:r2\.dev|pages\.dev|webflow\.io|localhost)$/.test(url.hostname)
    && !['127.0.0.1', '[::1]', '0.0.0.0'].includes(url.hostname), 'Forbidden necessary-media origin');
  return url;
}
function srcsets(value) {
  return value.split(',').map((entry) => {
    const match = /^\s*(\S+)(?:\s+(\d+(?:\.\d+)?[wx]))?\s*$/.exec(entry);
    check(match, 'Invalid published srcset'); return { url: match[1], descriptor: match[2] ?? null };
  });
}

function inspect({ html, status, url, route, fixture = false }, source) {
  const requested = approvedUrl(url); check(ROUTES.has(route) && source.route.route === route, 'Unsupported or mismatched logical route');
  const expectedStatus = route === '/404' ? 404 : 200;
  if (route === '/404') check(!ROUTES.has(requested.pathname), '/404 must be tested through a precise unknown pathname');
  check(status === expectedStatus, `HTTP status is ${status}, expected ${expectedStatus}`);
  check(typeof html === 'string' && Buffer.byteLength(html) <= MAX_HTML_BYTES, 'Staging HTML exceeds bounded inspection size');
  const document = parseHtml(html);
  const navigationSource = readFileSync(resolve(dirname(SCRIPT), '../designer/native-navigation.js'), 'utf8').trim();
  check(all(document, (node) => node.tag === 'script' && attr(node, 'src') === undefined)
    .some((node) => (node.children ?? []).map((child) => child.text ?? '').join('').trim() === navigationSource),
  'Native navigation source script missing or changed');
  const htmlRoot = one(all(document, (node) => node.tag === 'html'), 'Published html element');
  equal(attr(htmlRoot, 'lang'), 'zh-TW', 'Published language'); equal(attr(htmlRoot, 'data-wf-site'), SITE_ID, 'Published site ID');
  equal(attr(htmlRoot, 'data-wf-domain'), requested.hostname, 'Published approved domain');
  const page = one(all(document, (node) => attr(node, 'data-iv1-route') !== undefined), 'Published native route');
  equal(attr(page, 'data-iv1-route'), route, 'Native logical route');
  const nativePage = nativeProjection(page);
  const sourceRoot = one(source.page.tree.children.filter((node) => node.tag), 'Package page root');
  const frozenText = normalizedFrozenText(nativePage); const expectedFrozenText = normalizedFrozenText(sourceRoot);
  equal(frozenText, expectedFrozenText, 'Native frozen rendered text');
  const nativeH1 = one(all(page, (node) => node.tag === 'h1', true), 'Native H1');
  const expectedH1 = one(all(sourceRoot, (node) => node.tag === 'h1'), 'Package H1');
  equal(attr(nativeH1, 'id'), attr(expectedH1, 'id'), 'Native H1 ID'); equal(normalizedFrozenText(nativeH1), normalizedFrozenText(expectedH1), 'Native H1 copy');
  const ctas = all(nativePage, (node) => hasClass(node, 'iv1-primary-cta'));
  const expectedCtas = all(sourceRoot, (node) => hasClass(node, 'iv1-primary-cta'));
  equal(ctas.length, route === '/404' ? 0 : 1, 'Native CTA count'); equal(ctas.length, expectedCtas.length, 'Package CTA count');
  ctas.forEach((cta, index) => {
    equal(cta.tag, 'a', 'Native CTA tag');
    for (const name of ['href', 'target', 'rel']) equal(attr(cta, name), attr(expectedCtas[index], name), `Native CTA ${name}`);
    equal(normalizedFrozenText(cta), normalizedFrozenText(expectedCtas[index]), 'Native CTA copy');
  });
  const links = all(nativePage, (node) => node.tag === 'a'); const expectedLinks = all(sourceRoot, (node) => node.tag === 'a');
  const nativeImages = all(nativePage, (node) => node.tag === 'img'); const expectedImages = all(sourceRoot, (node) => node.tag === 'img');
  equal(nativeImages.length, expectedImages.length, 'Native image count');
  const imageDeclarationDifferences = [];
  nativeImages.forEach((image, index) => {
    forbiddenOrigin(attr(image, 'src'));
    check(sameManagedAsset(attr(image, 'src'), attr(expectedImages[index], 'src'), source), 'Native image identity/filename/width mapping mismatch');
    for (const name of ['alt', 'width', 'height', 'sizes', 'srcset']) equal(attr(image, name), attr(expectedImages[index], name), `Native image ${name}`);
    const width = attr(image, 'width'); const height = attr(image, 'height'); const expectedWidth = attr(expectedImages[index], 'width'); const expectedHeight = attr(expectedImages[index], 'height');
    if (width !== expectedWidth || height !== expectedHeight || attr(image, 'src') !== attr(expectedImages[index], 'src') || attr(image, 'loading') !== attr(expectedImages[index], 'loading')) imageDeclarationDifferences.push({ index, assetFileKey: managedAssetKey(attr(image, 'src')), actualWidth: width ?? null, actualHeight: height ?? null, packageWidth: expectedWidth ?? null, packageHeight: expectedHeight ?? null, urlNormalized: attr(image, 'src') !== attr(expectedImages[index], 'src'), actualLoading: attr(image, 'loading') ?? null, packageLoading: attr(expectedImages[index], 'loading') ?? null });
  });
  const wrapper = one(all(page, (node) => attr(node, 'id') === 'smooth-wrapper', true), 'Native smoother wrapper');
  const content = one(all(wrapper, (node) => attr(node, 'id') === 'smooth-content', true), 'Native smoother content');
  one(all(content, (node) => attr(node, 'id') === 'main-content', true), 'Native main content');
  check(all(wrapper, (node) => node.tag === 'header', true).length === 0, 'Fixed Header moved inside smoother');
  const namespace = new Set(Object.values(source.manifest.names.classes));
  const providerClasses = new Set(['w-inline-block', 'w-embed']);
  for (const node of all(page, () => true, true)) for (const name of (attr(node, 'class') ?? '').split(/\s+/).filter(Boolean)) {
    // Webflow marks links to this exact published page; no other provider class is exempt.
    if (name === 'w--current') { check(node.tag === 'a' && attr(node, 'href') === requested.pathname, 'Provider current class on a non-current link'); continue; }
    check(providerClasses.has(name) || name.startsWith('iv1-') && namespace.has(name), 'Published native class missing iv1 namespace');
  }
  // 對應package中的原生button，以hook/id及關鍵attribute驗公開HTML；不把a/Link算作button。
  const expectedButtons = all(sourceRoot, (node) => node.tag === 'button');
  check(expectedButtons.length > 0, 'Package has no native controls');
  for (const expected of expectedButtons) {
    const id = attr(expected, 'id'); const hook = expected.attrs.find(([name]) => name.startsWith('data-'))?.[0];
    check(id || hook, 'Native button needs stable hook/id');
    const actual = one(all(page, (node) => id ? attr(node, 'id') === id : attr(node, hook) !== undefined, true), 'Native button hook');
    equal(actual.tag, 'button', 'Native control actual tag');
    for (const name of ['type', 'aria-label', 'aria-controls', 'aria-expanded']) equal(attr(actual, name), attr(expected, name), `Native button ${name}`);
    equal([...new Set((attr(actual, 'class') ?? '').split(/\s+/))].sort(), [...new Set((attr(expected, 'class') ?? '').split(/\s+/))].sort(), 'Native button class');
    for (const child of expected.children.filter((node) => node.tag)) {
      const marker = one(all(actual, (node) => node.tag === child.tag && attr(node, 'class') === attr(child, 'class')), 'Native button child');
      equal(attr(marker, 'aria-hidden'), attr(child, 'aria-hidden'), 'Native button child accessibility');
    }
    if (attr(expected, 'aria-controls') !== undefined) one(all(page, (node) => attr(node, 'id') === attr(expected, 'aria-controls'), true), 'Native button aria-controls target');
  }
  equal(all(page, (node) => node.tag === 'button', true).length, expectedButtons.length, 'Native button count');
  equal(links.length, expectedLinks.length, 'Native nav/link count');
  links.forEach((link, index) => { for (const name of ['href', 'target', 'rel']) equal(attr(link, name), attr(expectedLinks[index], name), `Native link ${name}`); });
  const geometry = (svg) => all(svg, (node) => ['path', 'circle', 'rect', 'line', 'polyline', 'polygon', 'ellipse'].includes(node.tag)).map((node) => ({ tag: node.tag, attrs: Object.fromEntries(node.attrs.filter(([name]) => !['class', 'xmlns'].includes(name)).sort(([a], [b]) => a.localeCompare(b))) }));
  const effectiveHidden = (tree, target, inherited = false) => {
    const hidden = inherited || attr(tree, 'aria-hidden') === 'true';
    if (tree === target) return hidden;
    for (const child of tree.children ?? []) { const result = effectiveHidden(child, target, hidden); if (result !== undefined) return result; }
    return undefined;
  };
  const svgs = all(nativePage, (node) => node.tag === 'svg'); const expectedSvgs = all(sourceRoot, (node) => node.tag === 'svg');
  equal(svgs.length, expectedSvgs.length, 'Native SVG count');
  svgs.forEach((svg, index) => {
    for (const name of ['viewbox', 'fill', 'stroke', 'stroke-width', 'stroke-linecap', 'stroke-linejoin']) equal(attr(svg, name), attr(expectedSvgs[index], name), `Native SVG ${name}`);
    equal(geometry(svg), geometry(expectedSvgs[index]), 'Native SVG geometry/props');
    equal(effectiveHidden(nativePage, svg), effectiveHidden(sourceRoot, expectedSvgs[index]), 'Native SVG effective aria-hidden');
    if (attr(svg, 'focusable') !== attr(expectedSvgs[index], 'focusable')) check(attr(expectedSvgs[index], 'focusable') === 'false' && attr(svg, 'focusable') === undefined && effectiveHidden(nativePage, svg) === true && (attr(svg, 'tabindex') === undefined || Number(attr(svg, 'tabindex')) < 0), 'Native SVG focusability mismatch');
  });
  const details = all(nativePage, (node) => node.tag === 'details'); const expectedDetails = all(sourceRoot, (node) => node.tag === 'details');
  equal(details.length, expectedDetails.length, 'Native details count');
  details.forEach((node, index) => { equal(attr(node, 'name'), attr(expectedDetails[index], 'name'), 'Native details group'); equal(booleanAttribute(node, 'open'), booleanAttribute(expectedDetails[index], 'open'), 'Native details initial open'); one(node.children.filter((child) => child.tag === 'summary'), 'Native details summary'); });
  if (route === '/plan') check(details.length === 6 && details.every((node) => attr(node, 'name') === 'plan-group'), 'Plan six mutually exclusive groups');
  if (route === '/about') {
    check(all(nativePage, (node) => hasClass(node, 'iv1-secondary-nearby-card')).length === 10, 'About ten recommendation cards');
    const iot = one(all(nativePage, (node) => attr(node, 'id') === 'about-iot-heading'), 'About IoT heading');
    equal(normalizedFrozenText(iot), normalizedFrozenText(one(all(sourceRoot, (node) => attr(node, 'id') === 'about-iot-heading'), 'Package IoT heading')), 'About IoT copy');
  }
  const videos = all(nativePage, (node) => node.tag === 'video'); const expectedVideos = all(sourceRoot, (node) => node.tag === 'video');
  const heroRuntimeRestorationRequired = [];
  equal(videos.length, route === '/' ? 1 : 0, 'Native Hero only on home'); equal(videos.length, expectedVideos.length, 'Native Hero video count');
  if (route === '/') {
    const video = videos[0]; const expected = expectedVideos[0];
    for (const name of ['muted', 'loop', 'playsinline']) {
      check(booleanAttribute(expected, name), `Package native Hero ${name}`);
      if (!booleanAttribute(video, name)) { check(source.runtimeSourceContract.heroBooleanRestoreBeforePlay, `Native Hero ${name} missing without source recovery`); heroRuntimeRestorationRequired.push(name); }
    }
    for (const name of ['preload', 'poster', 'aria-hidden']) equal(attr(video, name), attr(expected, name), `Native Hero ${name}`);
    const sources = all(video, (node) => node.tag === 'source'); const expectedSources = all(expected, (node) => node.tag === 'source');
    equal(sources.length, 2, 'Native Hero dual sources'); sources.forEach((node, index) => { for (const name of ['src', 'type', 'media']) equal(attr(node, name), attr(expectedSources[index], name), `Native Hero source ${name}`); });
    const picture = one(all(nativePage, (node) => node.tag === 'picture'), 'Native Hero poster picture'); const expectedPicture = one(all(sourceRoot, (node) => node.tag === 'picture'), 'Package Hero poster picture');
    const posterSources = all(picture, (node) => node.tag === 'source'); const expectedPosterSources = all(expectedPicture, (node) => node.tag === 'source');
    equal(posterSources.length, expectedPosterSources.length, 'Native Hero poster source count');
    posterSources.forEach((node, index) => { for (const name of ['srcset', 'media', 'type']) equal(attr(node, name), attr(expectedPosterSources[index], name), `Native Hero poster ${name}`); });
  }
  const islands = all(document, (node) => node.tag === 'code-island');
  const expectedIslandNames = route === '/404' ? [] : route === '/spaces' ? ['InvillageSpaces', 'InvillagePageRuntime'] : ['InvillagePageRuntime'];
  check(islands.length === expectedIslandNames.length, 'Unexpected provider CodeIsland count');
  const loaderRows = []; const moduleIds = new Set();
  for (const island of islands) {
    const loader = JSON.parse(attr(island, 'data-loader'));
    check(loader.tag === 'FEDERATION' && loader.val?.exportPath === 'default', 'Unexpected CodeIsland loader shape');
    const client = forbiddenOrigin(loader.val.clientModuleUrl);
    check(client.hostname === 'code-components.website-files.com' && !client.search && !client.hash, 'CodeIsland loader is not official provider');
    const libraryId = decodeURIComponent(client.pathname).split('/').filter(Boolean)[0];
    check(/^[a-f0-9]{24}$/.test(libraryId) && loader.val.moduleId === `_${libraryId}`, 'CodeIsland module identity mismatch');
    check(expectedIslandNames.includes(loader.val.submoduleId), 'Unexpected CodeIsland component');
    moduleIds.add(loader.val.moduleId);
    equal(attr(island, 'data-hydrate'), 'true', 'CodeIsland hydration declaration');
    equal(attr(island, 'data-interactive'), 'true', 'CodeIsland interactive declaration');
    const context = JSON.parse(attr(island, 'data-webflow-context'));
    check(context.mode === 'publish' && context.locale === 'zh-TW' && context.interactive === true, 'CodeIsland published context mismatch');
    const template = one(island.children.filter((node) => node.tag === 'template' && attr(node, 'shadowrootmode') === 'open'), 'CodeIsland declarative Shadow DOM');
    check(all(template, (node) => node.tag === 'h1').length === 0, 'CodeIsland SSR duplicates native H1');
    const styles = all(template, (node) => node.tag === 'link' && attr(node, 'rel') === 'stylesheet');
    if (loader.val.submoduleId === 'InvillageSpaces') check(styles.length > 0, 'Spaces CodeIsland SSR has no stylesheet declaration');
    for (const style of styles) {
      const href = forbiddenOrigin(attr(style, 'href'));
      check(href.hostname === client.hostname && decodeURIComponent(href.pathname).startsWith(`/${libraryId}/module/`), 'CodeIsland stylesheet identity mismatch');
    }
    const props = JSON.parse(attr(island, 'data-props'));
    if (loader.val.submoduleId === 'InvillagePageRuntime') {
      const marker = one(all(template, (node) => attr(node, RUNTIME_MARKER) !== undefined), 'Runtime SSR marker');
      equal(marker.tag, 'span', 'Runtime SSR marker tag');
      check(booleanAttribute(marker, 'hidden') && attr(marker, 'aria-hidden') === 'true', 'Runtime SSR marker must be hidden/aria-hidden');
      check(all(template, (node) => ['img', 'video', 'picture', 'source', 'button', 'section', 'article', 'nav', 'header', 'footer', 'h1', 'h2', 'h3'].includes(node.tag)).length === 0, 'Runtime SSR must not contain Spaces/Hero or page content');
      check(all(template, (node) => (attr(node, 'class') ?? '').split(/\s+/).some((name) => /^(?:iv1-)?(?:spaces|hero)(?:-|$)/.test(name))).length === 0, 'Runtime SSR leaked Spaces/Hero classes');
      check(normalizedFrozenText({ tag: '#document', attrs: [], children: template.children }) === '', 'Runtime SSR must not expose visible text');
      check(['原版動態', '靜態'].includes(props.variant), 'Runtime variant metadata mismatch');
    }
    if (loader.val.submoduleId === 'InvillageSpaces') {
      equal(props.title, source.data.title, 'SSR spaces title prop');
      const interactiveScene = one(all(template, (node) => hasClass(node, 'spaces-immersive')), 'SSR interaction readiness scene');
      equal(attr(interactiveScene, 'data-interactive-ready'), 'false', 'SSR controls readiness declaration');
      equal(attr(interactiveScene, 'aria-busy'), 'true', 'SSR readiness accessibility');
      const guardedControls = [
        ...all(one(all(template, (node) => hasClass(node, 'spaces-categories')), 'SSR categories'), (node) => node.tag === 'button'),
        ...all(template, (node) => hasClass(node, 'spaces-thumbnail') || hasClass(node, 'spaces-gallery-item') || hasClass(node, 'spaces-expand-button')),
        ...all(one(all(template, (node) => hasClass(node, 'spaces-arrows')), 'SSR arrows'), (node) => node.tag === 'button'),
      ];
      check(guardedControls.length > 0 && guardedControls.every((node) => booleanAttribute(node, 'disabled')), 'SSR control enabled before hydration');
      const stage = one(all(template, (node) => hasClass(node, 'spaces-stage-media') && attr(node, 'data-space-id') !== undefined), 'SSR stage data');
      equal(attr(stage, 'data-space-id'), source.data.sharedSpaces[0].id, 'SSR initial public space');
      const image = one(all(stage, (node) => node.tag === 'img'), 'SSR stage image');
      equal(attr(image, 'src'), source.data.sharedSpaces[0].media.small, 'SSR initial stage source');
      const current = source.data.sharedSpaces[0];
      equal(attr(image, 'alt'), current.imageAlt, 'SSR stage alt');
      const gallery = one(all(template, (node) => hasClass(node, 'spaces-gallery')), 'SSR current gallery');
      equal(attr(gallery, 'data-space-id'), current.id, 'SSR gallery selected space'); equal(Number(attr(gallery, 'data-gallery-count')), current.gallery.length, 'SSR gallery count');
      const photos = all(gallery, (node) => attr(node, 'data-gallery-asset-id') !== undefined);
      equal(photos.map((node) => attr(node, 'data-gallery-asset-id')), current.gallery.map((photo) => photo.assetId), 'SSR gallery photo membership/order');
      photos.forEach((node, index) => {
        const photo = current.gallery[index]; equal(node.tag, 'button', 'SSR gallery control tag'); equal(attr(node, 'type'), 'button', 'SSR gallery button type');
        equal(attr(node, 'aria-label'), `查看完整照片：${photo.alt}`, 'SSR gallery control label');
        const img = one(all(node, (item) => item.tag === 'img'), 'SSR gallery image');
        for (const name of ['alt', 'width', 'height']) equal(attr(img, name), String(photo[name]), `SSR gallery ${name}`);
        equal(attr(img, 'src'), photo.variants[0].url, 'SSR gallery image source');
        equal(srcsets(attr(img, 'srcset')), photo.variants.map((variant) => ({ url: variant.url, descriptor: `${variant.width}w` })), 'SSR gallery responsive sources');
      });
    }
    loaderRows.push({ component: loader.val.submoduleId, moduleId: loader.val.moduleId, shadowRootMode: 'open', stylesheetDeclarations: styles.length,
      runtimeMarker: loader.val.submoduleId === 'InvillagePageRuntime' ? RUNTIME_MARKER : null, ssrH1: 0, ssrButtons: all(template, (node) => node.tag === 'button').length });
  }
  check(moduleIds.size === (expectedIslandNames.length ? 1 : 0), 'CodeIsland libraries disagree'); equal(loaderRows.map((row) => row.component).sort(), [...expectedIslandNames].sort(), 'CodeIsland component contract');
  const noscripts = all(page, (node) => node.tag === 'noscript' && all(node, (child) => hasClass(child, 'iv1-spaces-fallback')).length > 0, true);
  check(noscripts.length === (route === '/spaces' ? 2 : 0), 'Unexpected literal fallback noscript blocks');
  const articles = []; const images = []; const ids = []; const embeds = [];
  for (const [index, block] of noscripts.entries()) {
    const expected = source.embeds[index]; const literal = serialize(block);
    check(literal.length < 50_000, 'Published literal fallback exceeds Embed character limit');
    equal(literal, expected.content, 'Published literal fallback/package');
    check(all(block, (node) => node.tag === 'h1').length === 0, 'Fallback duplicates H1');
    articles.push(...all(block, (node) => node.tag === 'article')); images.push(...all(block, (node) => node.tag === 'img'));
    ids.push(...all(block, (node) => attr(node, 'data-gallery-asset-id') !== undefined).map((node) => attr(node, 'data-gallery-asset-id')));
    embeds.push({ characters: literal.length, articles: all(block, (node) => node.tag === 'article').length, images: all(block, (node) => node.tag === 'img').length });
  }
  if (route === '/spaces') {
    check(articles.length === 16 && images.length === 78 && ids.length === 78 && new Set(ids).size === 77, 'Published fallback content/photo counts mismatch');
    check(!ids.some((id) => HOLDS.has(id)), 'Published fallback contains held photo');
    equal(ids, [...source.data.sharedSpaces, ...source.data.rooms].flatMap((item) => item.gallery.map((photo) => photo.assetId)), 'Fallback/component complete photo order');
  }
  const media = new Set();
  function mediaUrl(value) { forbiddenOrigin(value); check(source.targets.has(value) || source.assetFiles.has(managedAssetKey(value)), 'Necessary media URL is not in native package mapping'); media.add(value); }
  // 原生與SSR兩邊的直接媒體URL都核；provider CSS/JS只核引用origin，不抓取其內容。
  for (const node of all(document, () => true)) {
    for (const name of ['src', 'poster']) if (attr(node, name) !== undefined) {
      if (node.tag === 'script') forbiddenOrigin(attr(node, name));
      else mediaUrl(attr(node, name));
    }
    for (const name of ['srcset', 'imagesrcset']) if (attr(node, name) !== undefined) {
      for (const entry of srcsets(attr(node, name))) {
        mediaUrl(entry.url);
        if (entry.descriptor?.endsWith('w')) equal(Number(entry.descriptor.slice(0, -1)), source.widths.get(entry.url) ?? source.assetFiles.get(managedAssetKey(entry.url))?.width, 'Published managed srcset width');
      }
    }
    if (node.tag === 'link' && attr(node, 'rel') === 'preload' && attr(node, 'as') === 'image' && attr(node, 'href') !== undefined) mediaUrl(attr(node, 'href'));
    if (node.tag === 'style' || attr(node, 'style') !== undefined) {
      const css = node.tag === 'style' ? node.children.map((child) => child.text ?? '').join('') : attr(node, 'style');
      for (const match of css.matchAll(/url\(\s*(?:"([^"\n]*)"|'([^'\n]*)'|([^)'"\s]*))\s*\)/gi)) mediaUrl(match[1] ?? match[2] ?? match[3]);
    }
  }
  return { status: 'PASS', scope: fixture ? 'offline-generated-html-fixture-only' : 'published-static-html-only', fixture, liveVerified: !fixture,
    url: approvedUrl(url).href, logicalRoute: route, httpStatus: status,
    siteId: SITE_ID, lang: 'zh-TW', htmlBytes: Buffer.byteLength(html), htmlSha256: sha(html), verifierSha256: sha(readFileSync(SCRIPT)),
    packageManifestSha256: source.manifestSha256, nativeH1: 1, ctas: ctas.length, nativeButtons: expectedButtons.length, codeIslands: loaderRows,
    nativeFrozenTextSha256: sha(frozenText), packageFrozenTextSha256: sha(expectedFrozenText), nativeImages: nativeImages.length, nativeLinks: links.length,
    nativeSvgCount: svgs.length, planGroupCount: route === '/plan' ? details.length : null, aboutRecommendations: route === '/about' ? 10 : null,
    nativeHeroVideos: videos.length, runtimeSourceContract: source.runtimeSourceContract, heroRuntimeRestorationRequired, imageDeclarationDifferences,
    fallback: route === '/spaces' ? { literalNoscripts: 2, articles: 16, images: 78, uniqueAssets: 77, holds: 0, embeds } : null, mappedMediaUrls: media.size,
    gaps: ['CodeIsland的data-hydrate/interactive及SSR只是靜態宣告，不等於Shadow DOM互動、鍵盤、焦點或照片重試通過',
      'literal noscript存在不等於JS-off可见性、版面或手機/桌機/Safari真機驗收',
      '沒有抓外部CSS/JS、媒體bytes或實際尺寸，無法替代bundle內相依/managed資產/供應完整性驗證',
      'NativeImage width/height/sizes/srcset保持source嚴格合同；loading差異有明列，未驗CLS/LCP。Hero缺少布林HTMLattribute時只證本機Runtime播放前恢復邏輯，未驗live播放',
      '只證此URL/route與package的靜態合同，不能推論其他未檢查route、CSS視覺、SEO、發布/回退'] };
}

export function verifyStagingHtml(input) { return inspect(input, reference(input.packageDir, input.route)); }
export function verifyOfflineStagingFixtures(input) {
  const source = reference(input.packageDir, input.route);
  inspect(input, source);
  return { scope: 'offline-html-fixtures-only', verifierSha256: sha(readFileSync(SCRIPT)), baselineFixtureHtmlSha256: sha(input.html), offlineNegatives: offlineNegatives(input, source) };
}

// 只在RAM組合本機核准片段與明示provider合同；fixture library ID/URL不是真實發布證據。
export function createOfflineStagingFixture({ packageDir, route, origin = 'https://invillage.webflow.io', svgAriaOnSvg = false }) {
  check(ROUTES.has(route) && ORIGINS.has(origin), 'Invalid offline fixture route/origin');
  const source = reference(packageDir, route);
  const element = (tag, attrs = {}, children = []) => ({ tag, attrs: Object.entries(attrs), children });
  const nodeText = (value) => ({ text: value });
  const library = '000000000000000000000000';
  function island(name, props, children) {
    return element('code-island', {
      'data-loader': JSON.stringify({ tag: 'FEDERATION', val: { clientModuleUrl: `https://code-components.website-files.com/${library}%2Fmodule%2Fwf-manifest.json`, moduleId: `_${library}`, submoduleId: name, exportPath: 'default', serverModuleUrl: '_' } }),
      'data-props': JSON.stringify(props), 'data-slots': '[]', 'data-hydrate': 'true', 'data-interactive': 'true',
      'data-webflow-context': JSON.stringify({ mode: 'publish', interactive: true, locale: 'zh-TW' }), style: 'display:contents',
    }, [element('template', { shadowrootmode: 'open' }, children)]);
  }
  const root = structuredClone(source.page.tree.children.find((node) => node.tag));
  if (route === '/spaces') {
    const current = source.data.sharedSpaces[0];
    const stageSrcset = ['small', 'medium', 'large'].map((role) => `${current.media[role]} ${current.media.widths[role]}w`).join(', ');
    const stage = element('div', { class: 'spaces-stage-media', 'data-space-id': current.id }, [element('img', { src: current.media.small, srcset: stageSrcset, alt: current.imageAlt })]);
    const gallery = element('div', { class: 'spaces-gallery', 'data-space-id': current.id, 'data-gallery-count': String(current.gallery.length) }, current.gallery.map((photo) => element('button', {
      class: 'spaces-gallery-item', type: 'button', 'data-gallery-asset-id': photo.assetId, 'aria-label': `查看完整照片：${photo.alt}`,
      disabled: null,
    }, [element('span', { class: 'spaces-gallery-frame' }, [element('img', { src: photo.variants[0].url, srcset: photo.variants.map((variant) => `${variant.url} ${variant.width}w`).join(', '), alt: photo.alt, width: String(photo.width), height: String(photo.height) })])])));
    const scene = element('section', { class: 'spaces-immersive', 'data-interactive-ready': 'false', 'aria-busy': 'true' }, [
      stage,
      element('div', { class: 'spaces-categories' }, [element('button', { disabled: null }), element('button', { disabled: null })]),
      element('div', { class: 'spaces-arrows' }, [element('button', { disabled: null }), element('button', { disabled: null })]),
      gallery,
    ]);
    const spaces = island('InvillageSpaces', { title: source.data.title }, [element('link', { rel: 'stylesheet', href: `https://code-components.website-files.com/${library}%2Fmodule%2Ffixture.css` }), element('div', {}, [scene])]);
    one(all(root, (node) => attr(node, 'data-iv1-code-component-slot') === 'SpacesExplorer'), 'Fixture Spaces slot').children.push(spaces);
    source.embeds.forEach((embed) => { one(all(root, (node) => attr(node, 'data-iv1-embed-slot') === embed.row.path), 'Fixture Embed slot').children.push(element('div', { class: 'w-embed' }, structuredClone(embed.tree.children))); });
  }
  if (svgAriaOnSvg) {
    const visit = (node) => {
      for (const child of node.children ?? []) {
        if (child.tag === 'svg' && attr(node, 'aria-hidden') === 'true') { node.attrs = node.attrs.filter(([name]) => name !== 'aria-hidden'); child.attrs.push(['aria-hidden', 'true']); }
        if (child.tag) visit(child);
      }
    }; visit(root);
  }
  const runtime = route === '/404' ? [] : [island('InvillagePageRuntime', { variant: '原版動態' }, [element('div', {}, [element('span', { hidden: null, 'aria-hidden': 'true', [RUNTIME_MARKER]: null })])])];
  const navigationSource = readFileSync(resolve(dirname(SCRIPT), '../designer/native-navigation.js'), 'utf8');
  const document = element('#document', {}, [element('html', { lang: 'zh-TW', 'data-wf-site': SITE_ID, 'data-wf-domain': new URL(origin).hostname }, [element('head', {}, [element('title', {}, [nodeText(source.route.title)]), element('script', {}, [nodeText(navigationSource)])]), element('body', {}, [root, ...runtime])])]);
  return { html: serialize(document), status: route === '/404' ? 404 : 200, route, url: `${origin}${route === '/404' ? '/__offline_fixture_unknown_path__' : route}`, packageDir, fixture: true };
}

export function verifyOfflineRouteFixtures({ packageDir }) {
  const positives = []; const negatives = [];
  for (const origin of ORIGINS) for (const route of ROUTES) {
    const input = createOfflineStagingFixture({ packageDir, route, origin });
    const source = reference(packageDir, route); const result = inspect(input, source);
    positives.push(result);
    if (origin === 'https://invillage.webflow.io') negatives.push(...offlineNegatives(input, source).map((row) => ({ ...row, route })));
  }
  const svgEquivalent = createOfflineStagingFixture({ packageDir, route: '/about', svgAriaOnSvg: true });
  positives.push({ ...verifyStagingHtml(svgEquivalent), fixtureVariation: 'decorative-svg-aria-hidden-on-svg-equivalent-to-wrapper' });
  const normalizedWhitespace = createOfflineStagingFixture({ packageDir, route: '/plan' });
  normalizedWhitespace.html = normalizedWhitespace.html.replace(/><(h[1-6]|p|section|div|article|ul|ol|li|details|summary|header|footer|nav|main)\b/g, '>\n  <$1');
  positives.push({ ...verifyStagingHtml(normalizedWhitespace), fixtureVariation: 'HTML-render-formatting-whitespace-only' });
  const managedAlias = createOfflineStagingFixture({ packageDir, route: '/' });
  const aliasTree = parseHtml(managedAlias.html);
  for (const image of all(aliasTree, (node) => node.tag === 'img', true)) image.attrs = image.attrs.map(([name, value]) => [name, name === 'src' && value.startsWith(`https://s3.amazonaws.com/webflow-prod-assets/${SITE_ID}/`) ? value.replace(`https://s3.amazonaws.com/webflow-prod-assets/${SITE_ID}/`, `https://cdn.prod.website-files.com/${SITE_ID}/`) : value]);
  managedAlias.html = serialize(aliasTree);
  positives.push({ ...verifyStagingHtml(managedAlias), fixtureVariation: 'same-site-same-assetId-exact-filename-managed-S3-to-CDN' });
  const rejectInput = (name, input, regex) => { let error; try { verifyStagingHtml(input); } catch (failure) { error = failure.message; } check(error && regex.test(error), `${name} negative was not rejected`); negatives.push({ name, route: input.route, rejected: true, fixtureHtmlSha256: sha(input.html), error, expectedFailureExitCode: 1 }); };
  const notFound = createOfflineStagingFixture({ packageDir, route: '/404' });
  rejectInput('404-returned-http200', { ...notFound, status: 200 }, /HTTP status/);
  rejectInput('404-not-an-unknown-path', { ...notFound, url: 'https://invillage.webflow.io/404' }, /precise unknown pathname/);
  rejectInput('unapproved-lookalike-host', { ...notFound, url: 'https://www.invillage.com.tw.evil.invalid/not-found' }, /exact approved/);
  rejectInput('unapproved-apex-host', { ...notFound, url: 'https://invillage.com.tw/not-found' }, /exact approved/);
  return { status: 'PASS', scope: 'generated-offline-route-fixtures-only', liveVerified: false, verifierSha256: sha(readFileSync(SCRIPT)),
    runtimeSourceContract: runtimeSourceContract(), positiveCases: positives, negativeCases: negatives,
    note: 'HTML只由本機package在RAM生成；HTTP status/provider library身份也為合成合同，沒有對外fetch、staging/production發布或live PASS。' };
}

async function fetchPublic(url, route) {
  let current = approvedUrl(url);
  const origin = current.origin;
  for (let redirects = 0; redirects <= 3; redirects++) {
    const response = await fetch(current, { credentials: 'omit', redirect: 'manual', signal: AbortSignal.timeout(15_000) });
    if ([301, 302, 303, 307, 308].includes(response.status)) {
      const location = response.headers.get('location'); check(location && redirects < 3, 'Missing/excess staging redirect');
      current = approvedUrl(new URL(location, current).href); check(current.origin === origin, 'Redirect leaves the explicitly selected origin'); await response.body?.cancel(); continue;
    }
    const expectedStatus = route === '/404' ? 404 : 200;
    check(response.status === expectedStatus, `HTTP status is ${response.status}, expected ${expectedStatus}`);
    let bytes = 0; const chunks = [];
    for await (const chunk of response.body) { bytes += chunk.byteLength; check(bytes <= MAX_HTML_BYTES, 'Staging HTML exceeds bounded inspection size'); chunks.push(chunk); }
    return { html: Buffer.concat(chunks).toString('utf8'), status: response.status, url: current.href };
  }
  throw new Error('Excess staging redirects');
}

function offlineNegatives(input, source) {
  const base = parseHtml(input.html);
  const cases = [
    ['wrong-language', (tree) => { const node = one(all(tree, (item) => item.tag === 'html'), 'Fixture html'); node.attrs = node.attrs.map(([key, value]) => [key, key === 'lang' ? 'en' : value]); }, /Published language/],
    ['button-converted-to-link', (tree) => { one(all(tree, (node) => attr(node, 'data-nav-toggle') !== undefined), 'Fixture toggle').tag = 'a'; }, /Native control actual tag/],
    ['duplicate-native-h1', (tree) => { const page = one(all(tree, (node) => attr(node, 'data-iv1-route') === input.route), 'Fixture route'); page.children.push({ tag: 'h1', attrs: [], children: [{ text: text(one(all(page, (node) => node.tag === 'h1', true), 'Fixture H1')) }] }); }, /Native frozen rendered text|Native H1/],
    ['r2-necessary-media', (tree) => { const image = one(all(tree, (node) => node.tag === 'img' && hasClass(node, 'iv1-brand-logo')).slice(0, 1), 'Fixture image'); image.attrs = image.attrs.map(([key, value]) => [key, key === 'src' ? 'https://unapproved.r2.dev/image.jpg' : value]); }, /Forbidden necessary-media origin/],
    ['missing-code-island', (tree) => { let removed = false; const visit = (node) => { node.children = (node.children ?? []).filter((child) => { if (!removed && child.tag === 'code-island') { removed = true; return false; } return true; }); for (const child of node.children) if (child.tag) visit(child); }; visit(tree); }, /Unexpected provider CodeIsland count/],
    ['changed-native-copy', (tree) => { const heading = one(all(tree, (node) => node.tag === 'h1', true), 'Fixture H1'); heading.children = [{ text: '未核准的新文案' }]; }, /Native frozen rendered text/],
    ['wrong-link-target', (tree) => { const link = all(tree, (node) => node.tag === 'a' && hasClass(node, 'iv1-brand'), true)[0]; link.attrs = link.attrs.filter(([name]) => name !== 'target'); link.attrs.push(['target', '_blank']); }, /Native link target/],
    ['wrong-runtime-marker', (tree) => { const marker = one(all(tree, (node) => attr(node, RUNTIME_MARKER) !== undefined), 'Fixture Runtime marker'); marker.attrs = marker.attrs.map(([name, value]) => [name === RUNTIME_MARKER ? 'data-iv1-runtime' : name, value]); }, /Runtime SSR marker/],
    ['runtime-extra-ssr-text', (tree) => { const island = one(all(tree, (node) => node.tag === 'code-island' && JSON.parse(attr(node, 'data-loader')).val.submoduleId === 'InvillagePageRuntime'), 'Fixture Runtime'); const template = one(all(island, (node) => node.tag === 'template'), 'Fixture Runtime template'); template.children.push({ tag: 'span', attrs: [], children: [{ text: 'unexpected content' }] }); }, /Runtime SSR must not expose visible text/],
    ['same-assetId-unknown-filename', (tree) => { const image = all(tree, (node) => node.tag === 'img' && hasClass(node, 'iv1-brand-logo'))[0]; image.attrs = image.attrs.map(([name, value]) => [name, name === 'src' ? value.replace(/\.png$/, '-unknown.png') : value]); }, /Native image identity\/filename\/width/],
    ['missing-native-intrinsic-width', (tree) => { const image = all(tree, (node) => node.tag === 'img' && hasClass(node, 'iv1-brand-logo'))[0]; image.attrs = image.attrs.filter(([name]) => name !== 'width'); }, /Native image width/],
  ].filter(([name]) => input.route !== '/404' || !['missing-code-island', 'wrong-runtime-marker', 'runtime-extra-ssr-text'].includes(name));
  cases.push(['missing-native-navigation', (tree) => {
    const head = all(tree, (node) => node.tag === 'head')[0];
    head.children = head.children.filter((node) => node.tag !== 'script');
  }, /Native navigation source script/]);
  if (input.route === '/404') cases.push(['utility404-unexpected-island', (tree) => {
    all(tree, (node) => node.tag === 'body')[0].children.push({ tag: 'code-island', attrs: [], children: [] });
  }, /Unexpected provider CodeIsland count/]);
  if (input.route === '/spaces') cases.push(
    ['missing-literal-photo', (tree) => { const fallback = all(tree, (node) => node.tag === 'noscript' && all(node, (child) => hasClass(child, 'iv1-spaces-fallback')).length > 0)[0]; let removed = false; const visit = (node) => { node.children = (node.children ?? []).filter((child) => { if (!removed && child.tag === 'img') { removed = true; return false; } return true; }); for (const child of node.children) if (child.tag) visit(child); }; visit(fallback); }, /Published literal fallback\/package/],
    ['wrong-ssr-gallery-membership', (tree) => { const item = all(tree, (node) => hasClass(node, 'spaces-gallery-item'))[0]; item.attrs = item.attrs.map(([name, value]) => [name, name === 'data-gallery-asset-id' ? [...HOLDS][0] : value]); }, /SSR gallery photo membership/],
  );
  if (input.route === '/plan') cases.push(['wrong-plan-group', (tree) => { const node = all(tree, (item) => item.tag === 'details')[0]; node.attrs = node.attrs.map(([name, value]) => [name, name === 'name' ? 'other-group' : value]); }, /Native details group|Plan six/]);
  if (input.route === '/about') cases.push(['wrong-svg-shape', (tree) => { const path = all(tree, (item) => item.tag === 'path')[0]; path.attrs = path.attrs.map(([name, value]) => [name, name === 'd' ? 'M0 0L1 1' : value]); }, /Native SVG geometry/]);
  if (input.route === '/') cases.push(['missing-mobile-hero-source', (tree) => { const video = all(tree, (item) => item.tag === 'video')[0]; let removed = false; video.children = video.children.filter((node) => { if (!removed && node.tag === 'source') { removed = true; return false; } return true; }); }, /Native Hero dual sources/]);
  return cases.map(([name, edit, expected]) => {
    const fixture = structuredClone(base); edit(fixture); const html = serialize(fixture);
    let failure;
    try { inspect({ ...input, html, fixture: true }, source); } catch (error) { failure = error.message; }
    check(failure && expected.test(failure), `Offline negative ${name} did not fail at its intended static gate`);
    return { name, fixtureHtmlSha256: sha(html), rejected: true, expectedFailureExitCode: 1, error: failure };
  });
}

async function main(args) {
  const options = {};
  for (let index = 0; index < args.length; index++) {
    if (args[index] === '--help') { console.log('node scripts/verify-designer-staging.mjs --url APPROVED_HTTPS_URL --route /|/spaces|/plan|/about|/contact|/404 --package-dir DIR [--self-test]\nnode scripts/verify-designer-staging.mjs --package-dir DIR --offline-fixtures\n只允許精確https://invillage.webflow.io或https://www.invillage.com.tw；/404需精確未知pathname/HTTP404。--offline-fixtures不fetch，RAM生成六route正/負例，不是live PASS。不存payload/headers/cookies。'); return; }
    if (args[index] === '--self-test') { check(!options.selfTest, 'Duplicate --self-test'); options.selfTest = true; continue; }
    if (args[index] === '--offline-fixtures') { check(!options.offlineFixtures, 'Duplicate --offline-fixtures'); options.offlineFixtures = true; continue; }
    const key = ({ '--url': 'url', '--route': 'route', '--package-dir': 'packageDir' })[args[index]];
    check(key && options[key] === undefined && args[index + 1] && !args[index + 1].startsWith('--'), 'Unknown/duplicate/missing CLI argument'); options[key] = args[++index];
  }
  if (options.offlineFixtures) {
    check(options.packageDir && !options.url && !options.route && !options.selfTest, '--offline-fixtures requires only --package-dir');
    console.log(JSON.stringify(verifyOfflineRouteFixtures({ packageDir: options.packageDir }), null, 2)); return;
  }
  check(options.url && ROUTES.has(options.route) && options.packageDir, '--url, supported --route and --package-dir are required');
  approvedUrl(options.url); const source = reference(options.packageDir, options.route); const response = await fetchPublic(options.url, options.route);
  const input = { ...response, route: options.route };
  let report;
  try { report = inspect(input, source); }
  catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', scope: 'published-static-html-only', url: response.url, logicalRoute: options.route,
      httpStatus: response.status, htmlBytes: Buffer.byteLength(response.html), htmlSha256: sha(response.html),
      verifierSha256: sha(readFileSync(SCRIPT)), packageManifestSha256: source.manifestSha256, error: error.message }));
    process.exitCode = 1; return;
  }
  if (options.selfTest) report.offlineNegatives = offlineNegatives(input, source);
  console.log(JSON.stringify(report, null, 2));
}
if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  try { await main(process.argv.slice(2)); }
  catch (error) { console.error(JSON.stringify({ status: 'FAIL', scope: 'published-static-html-only', error: error.message })); process.exitCode = 1; }
}
