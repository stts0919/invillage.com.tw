#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, realpathSync, statSync } from 'node:fs';
import { dirname, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { verifySpacesGallerySource } from './verify-spaces-gallery-source.mjs';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const spikeRoot = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(scriptDirectory, '../../../..');
const realRepositoryRoot = realpathSync(repositoryRoot);
const provenancePath = resolve(spikeRoot, 'reference/v1-preview-media-provenance.json');
const r2ManifestPath = resolve(repositoryRoot, 'assets/manifests/r2-upload-preview.json');
const classificationPath = resolve(repositoryRoot, 'assets/manifests/asset-classification.json');
const optimizationPath = resolve(repositoryRoot, 'assets/manifests/optimization-live.json');
const homeContentPath = resolve(spikeRoot, 'reference/home-content.json');
const spacesContentPath = resolve(spikeRoot, 'reference/spaces-content.json');
const spacesGalleryPath = resolve(spikeRoot, 'reference/spaces-gallery.json');
const imageAltsPath = resolve(spikeRoot, 'reference/image-alts.json');
const legacySlicePath = resolve(spikeRoot, 'reference/legacy-slice.json');
const routes = ['index', 'spaces', 'plan', 'about', 'contact', '404'];
const approvedPreviewBaseUrl = 'https://pub-a73a77b87d504498bad6ae568754e572.r2.dev';
const approvedPreviewBucket = 'invillage-media-preview';
const protocolRelativeR2 = /(?<!:)\/\/[a-z0-9.-]+\.r2\.dev(?=[:/?#\s"'<>)]|$)/i;
const expectedMainImageSizes = '(max-width: 48rem) max(54rem, 114svh), 100vw';

function gallerySizes(index, count) {
  const mobile = index % 2 === 0
    ? '(max-width: 48rem) calc(90vw - 2.25rem)'
    : '(max-width: 48rem) calc(100vw - 2.5rem)';
  if (count === 5 && index === 4) return `${mobile}, (max-width: 80rem) 67vw, 52rem`;
  return index % 4 === 0 || index % 4 === 3
    ? `${mobile}, (max-width: 80rem) 58vw, 44rem`
    : `${mobile}, (max-width: 80rem) 42vw, 32rem`;
}

function gallerySrcset(photo) {
  return photo.variants.map((variant) => `${variant.url} ${variant.width}w`).join(', ');
}

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('用法：node scripts/verify-v1-preview-media-provenance.mjs [--print] [--dist path]');
  process.exit(0);
}
let print = false;
let distRoot = resolve(spikeRoot, 'dist');
for (let index = 0; index < args.length; index += 1) {
  if (args[index] === '--print') print = true;
  else if (args[index] === '--dist' && args[index + 1]) distRoot = resolve(args[++index]);
  else throw new Error(`未知參數：${args[index]}`);
}

function readJson(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function verifiedLocalFile(path, prefix, bytes, expectedSha, label) {
  assert(typeof path === 'string' && path.startsWith(`${prefix}/`), `${label}：路徑不在 ${prefix}/`);
  const fullPath = resolve(repositoryRoot, path);
  assert(fullPath.startsWith(`${repositoryRoot}${sep}`), `${label}：路徑超出 repo`);
  assert(existsSync(fullPath) && statSync(fullPath).isFile(), `${label}：來源檔不存在 (${path})`);
  assert(realpathSync(fullPath).startsWith(`${realRepositoryRoot}${sep}`), `${label}：來源檔指向 repo 外`);
  assert(Number.isInteger(bytes) && statSync(fullPath).size === bytes, `${label}：bytes 不符 (${path})`);
  assert(/^[0-9a-f]{64}$/i.test(expectedSha) && sha256(fullPath) === expectedSha, `${label}：SHA-256 不符 (${path})`);
}

function assertSourceSnapshot(content, label) {
  assert(content?.schemaVersion === 1, `${label}：schemaVersion 不符`);
  assert(typeof content.sourcePath === 'string' && content.sourcePath.startsWith('apps/web/public/'), `${label}：sourcePath 不在舊站靜態基線`);
  const sourceRoot = resolve(repositoryRoot, 'apps/web/public');
  const fullPath = resolve(repositoryRoot, content.sourcePath);
  assert(fullPath.startsWith(`${sourceRoot}${sep}`), `${label}：來源 HTML 路徑超出舊站靜態基線`);
  assert(existsSync(fullPath) && statSync(fullPath).isFile(), `${label}：來源 HTML 不存在 (${content.sourcePath})`);
  assert(realpathSync(fullPath).startsWith(`${realpathSync(sourceRoot)}${sep}`), `${label}：來源 HTML 指向舊站靜態基線外`);
  assert(sha256(fullPath) === content.sourceSha256, `${label}：來源 HTML SHA-256 不符`);
}

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|[a-z][a-z0-9]+);/gi, (_, entity) => {
    if (entity[0] === '#') {
      const number = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(number) && number >= 0 && number <= 0x10ffff ? String.fromCodePoint(number) : `&${entity};`;
    }
    const decoded = { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[entity.toLowerCase()];
    assert(decoded !== undefined, `未支援的 HTML entity：&${entity};`);
    return decoded;
  });
}

function attribute(tag, name) {
  const match = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<>]+))`, 'i').exec(tag);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3]) : null;
}

function isPreviewR2Image(value) {
  if (!value) return false;
  try {
    const url = new URL(value);
    if (!url.hostname.endsWith('.r2.dev')) return false;
    assert(url.protocol === 'https:', `Preview R2 URL 不是 HTTPS：${value}`);
    return true;
  } catch (error) {
    if (value.includes('.r2.dev')) throw error;
    return false;
  }
}

function recordRemote(events, value, route, classification, sourceTag, alt = null, contentId = null) {
  if (!isPreviewR2Image(value)) return;
  events.push({ remoteUrl: value, route, classification, sourceTag, alt, contentId });
}

function srcsetUrls(value) {
  return value ? value.split(',').map((part) => part.trim().split(/\s+/)[0]).filter(Boolean) : [];
}

function normalizedText(value) {
  return decodeEntities(value.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ').trim();
}

function withoutHtmlComments(value, route) {
  const active = value.replace(/<!--[\s\S]*?-->/g, '');
  assert(!active.includes('<!--'), `${route}：HTML 註解未關閉`);
  return active;
}

function unpackAstro(value) {
  if (Array.isArray(value) && value.length === 2 && Number.isInteger(value[0])) {
    if (value[0] === 0) return unpackAstro(value[1]);
    if (value[0] === 1 && Array.isArray(value[1])) return value[1].map(unpackAstro);
    throw new Error(`Astro props 類型不支援：${value[0]}`);
  }
  if (Array.isArray(value)) return value.map(unpackAstro);
  if (value && typeof value === 'object') return Object.fromEntries(Object.entries(value).map(([key, item]) => [key, unpackAstro(item)]));
  return value;
}

function countUrls(values) {
  const counts = new Map();
  for (const value of values) counts.set(value, (counts.get(value) ?? 0) + 1);
  return counts;
}

function filesWithSuffix(directory, suffix) {
  return readdirSync(directory, { withFileTypes: true }).flatMap((entry) => {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) return filesWithSuffix(path, suffix);
    return entry.isFile() && entry.name.endsWith(suffix) ? [path] : [];
  });
}

function inspectSpacesHtml(html, expected, events, galleryEvents) {
  const first = expected.rooms[0];
  const mainImages = [...html.matchAll(/<div\b([^>]*\bclass="spaces-stage-media"[^>]*)><img\b([^>]*)>/gi)];
  assert(mainImages.length === 1, `/spaces：初始主圖數量 ${mainImages.length}，預期 1`);
  assert(attribute(mainImages[0][1], 'data-space-id') === first.id, '/spaces：初始主圖內容 ID 不符');
  const main = mainImages[0][2];
  const expectedSrcset = `${first.media.small} 640w, ${first.media.medium} 1280w, ${first.media.large} 1920w`;
  assert(attribute(main, 'src') === first.media.small && attribute(main, 'srcset') === expectedSrcset, '/spaces：初始主圖來源／srcset 不符');
  assert(attribute(main, 'alt') === first.imageAlt && first.imageAlt.trim(), '/spaces：初始主圖缺少正確 alt');
  assert(attribute(main, 'loading') === 'eager' && attribute(main, 'sizes') === expectedMainImageSizes, '/spaces：初始主圖 eager/sizes 不符');
  recordRemote(events, attribute(main, 'src'), '/spaces', 'ssr-initial-img', 'img-src', first.imageAlt, first.id);
  for (const url of srcsetUrls(attribute(main, 'srcset'))) recordRemote(events, url, '/spaces', 'ssr-initial-srcset-candidate', 'img-srcset', first.imageAlt, first.id);

  const thumbnails = [...html.matchAll(/<button\b([^>]*class="spaces-thumbnail"[^>]*)><img\b([^>]*)>/gi)];
  assert(thumbnails.length === expected.rooms.length, `/spaces：初始縮圖 ${thumbnails.length}，預期 ${expected.rooms.length}`);
  thumbnails.forEach((match, index) => {
    const item = expected.rooms[index];
    const button = match[1];
    const image = match[2];
    assert(attribute(button, 'aria-label') === item.label && attribute(button, 'aria-pressed') === String(index === 0), `/spaces：縮圖按鈕 ${item.id} 名稱／選取狀態不符`);
    assert(attribute(image, 'src') === item.media.small && attribute(image, 'alt') === '', `/spaces：縮圖 ${item.id} 來源／裝飾 alt 不符`);
    assert(attribute(image, 'loading') === (index < 2 ? 'eager' : 'lazy'), `/spaces：縮圖 ${item.id} loading 不符`);
    assert(attribute(image, 'srcset') === null, `/spaces：縮圖 ${item.id} 不應載入額外 srcset`);
    recordRemote(events, item.media.small, '/spaces', 'ssr-thumbnail-img', 'img-src', '', item.id);
  });

  const galleryRoot = html.match(/<div\b([^>]*\bclass="spaces-gallery"[^>]*)>([\s\S]*?)<\/div>/i);
  assert(galleryRoot && attribute(galleryRoot[1], 'data-space-id') === first.id, '/spaces：SSR 相簿不是目前選中客房');
  assert(attribute(galleryRoot[1], 'data-gallery-count') === String(first.gallery.length), '/spaces：SSR 相簿照片總數不符');
  const galleryButtons = [...galleryRoot[2].matchAll(/<button\b([^>]*\bclass="spaces-gallery-item"[^>]*)><span\b[^>]*\bclass="spaces-gallery-frame"[^>]*><img\b([^>]*)><\/span><\/button>/gi)];
  assert(galleryButtons.length === first.gallery.length, `/spaces：SSR 相簿 ${galleryButtons.length} 張，預期 ${first.gallery.length}`);
  galleryButtons.forEach((match, index) => {
    const photo = first.gallery[index];
    const button = match[1];
    const image = match[2];
    assert(attribute(button, 'data-gallery-asset-id') === photo.assetId && attribute(button, 'aria-label') === `查看完整照片：${photo.alt}`, `/spaces：SSR 相簿 ${photo.assetId} 按鈕歸屬不符`);
    assert(attribute(image, 'src') === photo.variants[0].url && attribute(image, 'srcset') === gallerySrcset(photo), `/spaces：SSR 相簿 ${photo.assetId} 來源不符`);
    assert(attribute(image, 'alt') === photo.alt && attribute(image, 'sizes') === gallerySizes(index, first.gallery.length), `/spaces：SSR 相簿 ${photo.assetId} alt/sizes 不符`);
    assert(attribute(image, 'width') === String(photo.width) && attribute(image, 'height') === String(photo.height), `/spaces：SSR 相簿 ${photo.assetId} 尺寸不符`);
    assert(attribute(image, 'loading') === 'lazy' && attribute(image, 'decoding') === 'async', `/spaces：SSR 相簿 ${photo.assetId} 懶載入／解碼不符`);
    recordRemote(galleryEvents, attribute(image, 'src'), '/spaces', 'ssr-gallery-img', 'img-src', photo.alt, first.id);
    for (const url of srcsetUrls(attribute(image, 'srcset'))) recordRemote(galleryEvents, url, '/spaces', 'ssr-gallery-srcset-candidate', 'img-srcset', photo.alt, first.id);
  });

  // The header has its own no-script navigation styles. Only the complete
  // spaces fallback owns these content/media checks.
  const fallback = [...html.matchAll(/<noscript>([^]*?)<\/noscript>/gi)].filter((match) =>
    /<section\b[^>]*\bclass="spaces-fallback"/.test(match[1]));
  assert(fallback.length === 1, '/spaces：無 JS fallback 數量不符');
  const headings = [...html.matchAll(/<h1\b[^>]*>([^]*?)<\/h1>/gi)];
  assert(headings.length === 1 && normalizedText(headings[0][1]) === normalizedText(expected.title), '/spaces：唯一 SSR 頁名缺失或不符');
  const fallbackCss = [...fallback[0][1].matchAll(/<style\b[^>]*>([^]*?)<\/style>/gi)]
    .map((match) => match[1].replace(/\/\*[^]*?\*\//g, '')).join('\n');
  const hiddenSelectors = new Set([...fallbackCss.matchAll(/([^{}]+)\{([^{}]*)\}/g)]
    .filter((match) => /\bdisplay\s*:\s*none\s*!important\s*(?:;|$)/i.test(match[2]))
    .flatMap((match) => match[1].split(',').map((selector) => selector.trim())));
  for (const selector of ['.spaces-stage-media', '.spaces-stage-shade', '.spaces-categories', '.spaces-stage-bottom', '.spaces-photo-dialog', '.spaces-bottom-panel', '.spaces-gallery-scene']) {
    assert(hiddenSelectors.has(selector), `/spaces：無 JS fallback 未隱藏互動區 ${selector}`);
  }
  for (const selector of ['.spaces-immersive', '.spaces-stage', '.spaces-stage-top', '.spaces-stage-top h1']) {
    assert(!hiddenSelectors.has(selector), `/spaces：無 JS fallback 不得隱藏頁名 ${selector}`);
  }
  const articles = [...fallback[0][1].matchAll(/<article>([^]*?)<\/article>/gi)];
  const allItems = [...expected.rooms, ...expected.sharedSpaces];
  assert(articles.length === allItems.length, `/spaces：無 JS fallback 內容 ${articles.length} 筆，預期 16`);
  articles.forEach((match, index) => {
    const item = allItems[index];
    const heading = match[1].match(/<h3>([^]*?)<\/h3>/i)?.[1];
    const paragraphs = [...match[1].matchAll(/<p\b[^>]*>([^]*?)<\/p>/gi)].map((paragraph) => normalizedText(paragraph[1]));
    const expectedParagraphs = item.label === item.panelHeading
      ? [normalizedText(item.description)]
      : [normalizedText(item.label), normalizedText(item.description)];
    const link = match[1].match(/<a\b([^>]*)>([^]*?)<\/a>/i);
    assert(heading !== undefined && normalizedText(heading) === normalizedText(item.panelHeading), `/spaces：無 JS fallback ${item.id} 標題缺失`);
    assert(isDeepStrictEqual(paragraphs, expectedParagraphs), `/spaces：無 JS fallback ${item.id} 原文／分類名稱缺失`);
    assert(link && attribute(link[1], 'href') === item.media.large && normalizedText(link[2]) === normalizedText(item.imageAlt), `/spaces：無 JS fallback ${item.id} 圖片連結／alt 缺失`);
    recordRemote(events, item.media.large, '/spaces', 'nojs-fallback-link-not-requested', 'a-href', item.imageAlt, item.id);
    const fallbackGallery = match[1].match(/<div\b[^>]*\bclass="spaces-fallback-gallery"[^>]*>([\s\S]*?)<\/div>/i);
    assert(fallbackGallery, `/spaces：無 JS fallback ${item.id} 相簿缺失`);
    const galleryLinks = [...fallbackGallery[1].matchAll(/<a\b([^>]*)><img\b([^>]*)><\/a>/gi)];
    assert(galleryLinks.length === item.gallery.length, `/spaces：無 JS fallback ${item.id} 照片數量不符`);
    galleryLinks.forEach((galleryMatch, photoIndex) => {
      const photo = item.gallery[photoIndex];
      const anchor = galleryMatch[1];
      const image = galleryMatch[2];
      assert(attribute(anchor, 'data-gallery-asset-id') === photo.assetId && attribute(anchor, 'href') === photo.variants[photo.variants.length - 1].url, `/spaces：無 JS 相簿 ${photo.assetId} 連結歸屬不符`);
      assert(attribute(image, 'src') === photo.variants[0].url && attribute(image, 'srcset') === gallerySrcset(photo), `/spaces：無 JS 相簿 ${photo.assetId} 來源不符`);
      assert(attribute(image, 'alt') === photo.alt && attribute(image, 'sizes') === gallerySizes(photoIndex, item.gallery.length), `/spaces：無 JS 相簿 ${photo.assetId} alt/sizes 不符`);
      assert(attribute(image, 'width') === String(photo.width) && attribute(image, 'height') === String(photo.height), `/spaces：無 JS 相簿 ${photo.assetId} 尺寸不符`);
      assert(attribute(image, 'loading') === 'lazy' && attribute(image, 'decoding') === 'async', `/spaces：無 JS 相簿 ${photo.assetId} 懶載入／解碼不符`);
      recordRemote(galleryEvents, attribute(anchor, 'href'), '/spaces', 'nojs-gallery-link-not-requested', 'a-href', photo.alt, item.id);
      recordRemote(galleryEvents, attribute(image, 'src'), '/spaces', 'nojs-gallery-img', 'img-src', photo.alt, item.id);
      for (const url of srcsetUrls(attribute(image, 'srcset'))) recordRemote(galleryEvents, url, '/spaces', 'nojs-gallery-srcset-candidate', 'img-srcset', photo.alt, item.id);
    });
  });

  const islands = [...html.matchAll(/<astro-island\b([^>]*)>/gi)];
  assert(islands.length === 1 && /SpacesExplorer/.test(attribute(islands[0][1], 'component-url') ?? ''), '/spaces：SpacesExplorer island 缺失或歧義');
  let props;
  try { props = unpackAstro(JSON.parse(attribute(islands[0][1], 'props'))); }
  catch { throw new Error('/spaces：互動 props 無法解析'); }
  assert(props.title === expected.title, '/spaces：互動頁名不符');
  assert(isDeepStrictEqual(props.rooms, expected.rooms) && isDeepStrictEqual(props.sharedSpaces, expected.sharedSpaces), '/spaces：互動 props 與16筆內容／媒體來源不符');
  for (const item of [...props.rooms, ...props.sharedSpaces]) {
    for (const [width, url] of [[640, item.media.small], [1280, item.media.medium], [1920, item.media.large]]) {
      recordRemote(events, url, '/spaces', 'interactive-available-not-requested', `props-${width}`, item.imageAlt, item.id);
    }
    for (const photo of item.gallery) {
      for (const variant of photo.variants) {
        recordRemote(galleryEvents, variant.url, '/spaces', 'interactive-gallery-available-not-requested', `props-${variant.width}`, photo.alt, item.id);
      }
    }
  }
  return { initialContentId: first.id, mainImageSizes: expectedMainImageSizes, thumbnailCount: thumbnails.length, fallbackCount: articles.length, interactiveCount: allItems.length };
}

function scanDist(expected) {
  const events = [];
  const galleryEvents = [];
  let spacesState;
  assert(existsSync(distRoot) && statSync(distRoot).isDirectory(), `dist 不存在：${distRoot}`);
  const htmlPaths = filesWithSuffix(distRoot, '.html').map((path) => relative(distRoot, path)).sort();
  assert(isDeepStrictEqual(htmlPaths, routes.map((route) => `${route}.html`).sort()), `dist HTML 路由集合不符：${htmlPaths.join(', ')}`);
  for (const routeName of routes) {
    const pagePath = resolve(distRoot, `${routeName}.html`);
    assert(existsSync(pagePath), `缺少 ${routeName}.html`);
    const route = routeName === 'index' ? '/' : `/${routeName}`;
    const rawHtml = readFileSync(pagePath, 'utf8');
    assert(!protocolRelativeR2.test(decodeEntities(rawHtml)), `${route}：不允許協定相對的 Preview R2 URL`);
    const html = withoutHtmlComments(rawHtml, route);
    for (const script of html.matchAll(/<script\b[^>]*>([\s\S]*?)<\/script>/gi)) {
      assert(!/\.r2\.dev/i.test(script[1]), `${route}：執行腳本含未分類的 Preview R2 host`);
    }

    if (route === '/spaces') {
      spacesState = inspectSpacesHtml(html, expected, events, galleryEvents);
    } else {
      for (const match of html.matchAll(/<img\b([^>]*)>/gi)) {
        const src = attribute(match[1], 'src');
        const alt = attribute(match[1], 'alt');
        const srcset = srcsetUrls(attribute(match[1], 'srcset'));
        if (isPreviewR2Image(src) || srcset.some(isPreviewR2Image)) assert(alt?.trim(), `${route}：R2 內容圖片缺少 alt`);
        recordRemote(events, src, route, 'ssr-content-img', 'img-src', alt);
        for (const url of srcset) recordRemote(events, url, route, 'ssr-content-srcset-candidate', 'img-srcset', alt);
      }
      for (const match of html.matchAll(/<source\b([^>]*)>/gi)) {
        recordRemote(events, attribute(match[1], 'src'), route, 'ssr-source', 'source-src');
        for (const url of srcsetUrls(attribute(match[1], 'srcset'))) recordRemote(events, url, route, 'ssr-source', 'source-srcset');
      }
      for (const match of html.matchAll(/<video\b([^>]*)>/gi)) recordRemote(events, attribute(match[1], 'poster'), route, 'ssr-video-poster', 'video-poster');
    }

    const rawUrls = [...decodeEntities(html).matchAll(/https?:\/\/[^\s"'<>]+\.r2\.dev\/[^\s"'<>]+/gi)].map((match) => match[0]);
    const rawCounts = countUrls(rawUrls);
    const classifiedCounts = countUrls([...events, ...galleryEvents].filter((event) => event.route === route).map((event) => event.remoteUrl));
    for (const url of new Set([...rawCounts.keys(), ...classifiedCounts.keys()])) {
      assert(rawCounts.get(url) === classifiedCounts.get(url), `${route}：未知或未分類 R2 URL／引用次數不符 (${url})`);
    }
  }
  for (const path of filesWithSuffix(distRoot, '.css')) {
    const css = readFileSync(path, 'utf8');
    assert(!protocolRelativeR2.test(css), `CSS ${relative(distRoot, path)} 有協定相對的 Preview R2 URL`);
    assert(!/https?:\/\/[^\s"')]+\.r2\.dev\//i.test(css), `CSS ${relative(distRoot, path)} 有未分類的 Preview R2 圖片`);
  }
  for (const path of filesWithSuffix(distRoot, '.js')) {
    const js = readFileSync(path, 'utf8');
    assert(!/\.r2\.dev/i.test(js), `JS ${relative(distRoot, path)} 有未分類的 Preview R2 host`);
  }
  assert(events.some((event) => event.route === '/'), 'V1 dist 首頁未找到 Preview R2 內容圖片');
  return { events, galleryEvents, spacesState };
}

function indexRows(rows, key) {
  const index = new Map();
  for (const row of rows) {
    const value = row?.[key];
    if (typeof value !== 'string') continue;
    const list = index.get(value) ?? [];
    list.push(row);
    index.set(value, list);
  }
  return index;
}

function uniqueRow(index, key, label) {
  const rows = index.get(key) ?? [];
  assert(rows.length === 1, `${label}：預期唯一對照，實際 ${rows.length} 筆 (${key})`);
  return rows[0];
}

function buildProvenance() {
  const homeContent = readJson(homeContentPath);
  const spacesContent = readJson(spacesContentPath);
  const galleryVerification = verifySpacesGallerySource();
  const gallerySource = galleryVerification.manifest;
  const imageAlts = readJson(imageAltsPath);
  const legacy = readJson(legacySlicePath);
  const r2Manifest = readJson(r2ManifestPath);
  const classification = readJson(classificationPath);
  const optimization = readJson(optimizationPath);
  assertSourceSnapshot(homeContent, 'home-content');
  assertSourceSnapshot(spacesContent, 'spaces-content');
  assert(Array.isArray(spacesContent.groups) && Array.isArray(r2Manifest.items) && Array.isArray(classification.images) && Array.isArray(optimization.images), '內容／R2／分類／優化 manifest schema 不符');
  assert(r2Manifest.schemaVersion === 1 && classification.schemaVersion === 1 && optimization.schemaVersion === 1, 'R2／分類／優化 manifest schemaVersion 不符');
  assert(r2Manifest.publicBaseUrl === approvedPreviewBaseUrl && r2Manifest.bucketName === approvedPreviewBucket, 'Preview R2 origin／bucket 與核准對照不符');
  assert(legacy.source.spacesHtml.sha256 === spacesContent.sourceSha256, '舊站 spaces 快照 SHA 不一致');

  const homeDirectUrls = JSON.stringify(homeContent).match(/https?:\/\/[^"\s]+\.r2\.dev\/[^"\s]+/g) ?? [];
  assert(homeDirectUrls.length === 0, 'home-content 有尚未分類的直接 Preview R2 URL');
  const contentRows = spacesContent.groups.flatMap((group) => group.items.map((item) => ({ ...item, kind: group.kind })));
  assert(contentRows.length === 16 && spacesContent.groups[0].items.length === 6 && spacesContent.groups[1].items.length === 10, '空間資料不是6房＋10公共空間');
  const contentById = indexRows(contentRows, 'id');
  assert([...contentById.values()].every((rows) => rows.length === 1), 'spaces-content 存在重複 content id');
  const galleryById = indexRows(gallerySource.galleries, 'contentId');
  const r2ByUrl = indexRows(r2Manifest.items, 'remoteUrl');
  const r2ByAsset = indexRows(r2Manifest.items, 'assetId');
  const classById = indexRows(classification.images, 'id');
  const optimizationById = indexRows(optimization.images, 'id');
  const expected = { title: legacy.titles.spaces, rooms: [], sharedSpaces: [] };
  const images = [];

  for (const content of contentRows) {
    const base = uniqueRow(r2ByUrl, content.imageUrl, `內容 ${content.id} 主 URL`);
    const assetId = base.assetId;
    const original = uniqueRow(classById, assetId, '圖片分類 manifest');
    const optimized = uniqueRow(optimizationById, assetId, '優化 manifest');
    assert(original.placement === 'r2' && original.id === assetId, `${content.id}：原圖分類不符`);
    assert(typeof imageAlts[content.id] === 'string' && imageAlts[content.id].trim(), `${content.id}：缺少圖片 alt`);
    verifiedLocalFile(original.sourcePath, 'imports/webflow/assets/images', original.sourceBytes, original.sha256, `original ${assetId}`);
    const assetUploads = r2ByAsset.get(assetId) ?? [];
    const variants = [];
    for (const width of [640, 1280, 1920]) {
      const uploads = assetUploads.filter((item) => item.localPath.endsWith(`-fallback-w${width}.jpg`));
      assert(uploads.length === 1, `${content.id}：${width}px JPEG 上傳映射歧義／缺失`);
      const upload = uploads[0];
      assert(upload.runtimeEnabled === true && upload.contentType === 'image/jpeg', `${content.id}：${width}px JPEG 不是 runtime 圖片`);
      assert(upload.remoteUrl === `${r2Manifest.publicBaseUrl}/${upload.r2Key}`, `${content.id}：${width}px R2 URL/key 不符`);
      const optimizedOutputs = optimized.outputs.filter((item) => item.path === upload.localPath);
      assert(optimizedOutputs.length === 1, `${content.id}：${width}px 優化輸出歧義／缺失`);
      const output = optimizedOutputs[0];
      assert(output.bytes === upload.bytes && output.sha256 === upload.sha256 && output.dimensions.width === width, `${content.id}：${width}px 優化／上傳資料不符`);
      assert(width <= Math.ceil(output.dimensions.height * 1.5) + 1, `${content.id}：${width}px 圖片比 3:2 更寬，主圖 sizes 估算不足`);
      verifiedLocalFile(upload.localPath, 'assets/optimized', upload.bytes, upload.sha256, `optimized ${assetId} ${width}px`);
      variants.push({ width, remoteUrl: upload.remoteUrl, r2Key: upload.r2Key, optimized: { path: upload.localPath, bytes: upload.bytes, sha256: upload.sha256, dimensions: output.dimensions } });
    }
    assert(variants[2].remoteUrl === content.imageUrl && base.sha256 === variants[2].optimized.sha256, `${content.id}：舊版 w1920 URL／SHA 對照不符`);
    const samples = legacy.roomsSample.filter((sample) => sample.imageAssetId === assetId);
    assert(samples.length <= 1, `${content.id}：本機客房樣本歧義`);
    const sample = samples[0];
    const localSmall = sample ? `apps/web/phase-b-spike/public/assets/images/${sample.id}.jpg` : null;
    if (sample) {
      assert(sample.imageSha256 === variants[0].optimized.sha256, `${content.id}：本機樣本與640px優化來源不符`);
      verifiedLocalFile(localSmall, 'apps/web/phase-b-spike/public/assets', variants[0].optimized.bytes, sample.imageSha256, `site copy ${content.id}`);
    }
    const media = {
      assetId,
      small: sample ? `/assets/images/${sample.id}.jpg` : variants[0].remoteUrl,
      medium: variants[1].remoteUrl,
      large: variants[2].remoteUrl,
    };
    const gallerySourceRow = uniqueRow(galleryById, content.id, 'gallery manifest');
    assert(gallerySourceRow.kind === content.kind && gallerySourceRow.sourceTab === content.sourceTab, `${content.id}：gallery 分類／tab 不符`);
    const gallery = gallerySourceRow.photos.filter((photo) => photo.status !== 'hold').map((photo) => {
      const galleryAsset = uniqueRow(optimizationById, photo.assetId, 'gallery 優化 manifest');
      assert(galleryAsset.placement === 'r2' && Number.isInteger(galleryAsset.dimensions.width) && Number.isInteger(galleryAsset.dimensions.height), `${content.id}：gallery 原圖尺寸不符`);
      const jpegVariants = (r2ByAsset.get(photo.assetId) ?? []).flatMap((upload) => {
        const widthMatch = /-fallback-w(\d+)\.jpg$/.exec(upload.localPath);
        if (!widthMatch || upload.runtimeEnabled !== true || upload.contentType !== 'image/jpeg') return [];
        const output = galleryAsset.outputs.filter((candidate) => candidate.path === upload.localPath);
        assert(output.length === 1 && output[0].bytes === upload.bytes && output[0].sha256 === upload.sha256 && output[0].dimensions.width === Number(widthMatch[1]), `${content.id}：gallery JPEG 對照不符`);
        assert(upload.remoteUrl === `${r2Manifest.publicBaseUrl}/${upload.r2Key}`, `${content.id}：gallery Preview URL/key 不符`);
        return [{ width: output[0].dimensions.width, url: upload.remoteUrl }];
      }).sort((a, b) => a.width - b.width);
      assert(jpegVariants.length >= 2 && jpegVariants[0].width === 640 && new Set(jpegVariants.map((variant) => variant.width)).size === jpegVariants.length, `${content.id}：gallery JPEG 尺寸歧義`);
      return { assetId: photo.assetId, alt: `${content.label}：${photo.scene}`, width: galleryAsset.dimensions.width, height: galleryAsset.dimensions.height, variants: jpegVariants };
    });
    assert(gallery.length >= 4 && gallery[0].assetId === assetId, `${content.id}：gallery 首圖或可用數量不符`);
    const expectedItem = { id: content.id, label: content.label, panelHeading: content.panelHeading, description: content.description, imageAlt: imageAlts[content.id], media, gallery };
    if (content.kind === 'rooms') expected.rooms.push(expectedItem);
    else if (content.kind === 'shared-spaces') expected.sharedSpaces.push(expectedItem);
    else throw new Error(`${content.id}：未知空間分類 ${content.kind}`);
    images.push({
      content: { id: content.id, kind: content.kind, label: content.panelHeading ?? content.label },
      assetId,
      original: { path: original.sourcePath, bytes: original.sourceBytes, sha256: original.sha256 },
      variants,
      localSmall,
    });
  }
  assert(expected.rooms.length === 6 && expected.sharedSpaces.length === 10, '互動資料不是6房＋10公共空間');
  assert(new Set(images.map((image) => image.assetId)).size === 16, '16 個空間沒有對應 16 個唯一資產');
  const { events, galleryEvents, spacesState } = scanDist(expected);
  const imageById = new Map(images.map((item) => [item.content.id, item]));
  const baseByUrl = new Map(images.map((item) => [item.variants[2].remoteUrl, item.content.id]));
  for (const event of events) {
    if (event.route === '/') {
      event.contentId = baseByUrl.get(event.remoteUrl) ?? null;
      assert(event.contentId, `首頁圖片沒有內容 ID：${event.remoteUrl}`);
    } else {
      assert(event.route === '/spaces' && event.contentId, `${event.route}：非預期的 R2 圖片用途`);
    }
    const image = imageById.get(event.contentId);
    assert(image && image.variants.some((variant) => variant.remoteUrl === event.remoteUrl), `${event.route}：未知 R2 變體 ${event.remoteUrl}`);
  }
  const expectedGalleryById = new Map([...expected.rooms, ...expected.sharedSpaces].map((item) => [item.id, item.gallery]));
  for (const event of galleryEvents) {
    assert(event.route === '/spaces' && event.contentId && event.alt?.trim(), `gallery 用途／alt 不符：${event.remoteUrl}`);
    const gallery = expectedGalleryById.get(event.contentId) ?? [];
    assert(gallery.some((photo) => photo.alt === event.alt && photo.variants.some((variant) => variant.url === event.remoteUrl)), `/spaces：未知或錯誤歸屬的 gallery URL ${event.remoteUrl}`);
  }
  for (const image of images) image.observed = events.filter((event) => event.contentId === image.content.id);
  const classifications = Object.fromEntries([...new Set(events.map((event) => event.classification))].sort().map((name) => [name, events.filter((event) => event.classification === name).length]));
  const galleryClassifications = Object.fromEntries([...new Set(galleryEvents.map((event) => event.classification))].sort().map((name) => [name, galleryEvents.filter((event) => event.classification === name).length]));
  const galleryPhotos = [...expected.rooms, ...expected.sharedSpaces].flatMap((item) => item.gallery);
  return {
    schemaVersion: 2,
    status: 'local-preview-provenance-v2-not-production-placement',
    sources: {
      dist: 'apps/web/phase-b-spike/dist',
      homeContent: 'apps/web/phase-b-spike/reference/home-content.json',
      spacesContent: 'apps/web/phase-b-spike/reference/spaces-content.json',
      spacesGallery: relative(repositoryRoot, spacesGalleryPath),
      imageAlts: 'apps/web/phase-b-spike/reference/image-alts.json',
      legacySlice: 'apps/web/phase-b-spike/reference/legacy-slice.json',
      r2UploadPreview: 'assets/manifests/r2-upload-preview.json',
      classification: 'assets/manifests/asset-classification.json',
      optimization: 'assets/manifests/optimization-live.json',
      previewBucket: r2Manifest.bucketName,
      previewBaseUrl: r2Manifest.publicBaseUrl,
    },
    historicalBaseline: {
      referenceSha256: 'deed602685892234a893cdf75b09f273b455af7b521d871a66896663e54b1a7c',
      note: 'Pre-S2 local V1 static /spaces: historical only, not a current usage assertion',
      urlCount: 16,
      uniqueAssetCount: 16,
      usageCount: 21,
      spacesRenderedR2Usages: 14,
    },
    summary: {
      contentCount: images.length,
      uniqueAssetCount: new Set(images.map((image) => image.assetId)).size,
      verifiedJpegVariantCount: images.reduce((sum, image) => sum + image.variants.length, 0),
      observedRemoteUrlCount: new Set(events.map((event) => event.remoteUrl)).size,
      classifiedRemoteOccurrenceCount: events.length,
      usageClassifications: classifications,
      spacesState,
      optimizedTotalBytes: images.reduce((sum, image) => sum + image.variants.reduce((total, variant) => total + variant.optimized.bytes, 0), 0),
      originalTotalBytes: images.reduce((sum, image) => sum + image.original.bytes, 0),
      routesWithPreviewR2: [...new Set(events.map((event) => event.route))].sort(),
      homeContentDirectUrlCount: homeDirectUrls.length,
      unknownCount: 0,
      ambiguousCount: 0,
      missingLocalCount: 0,
      missingAltCount: 0,
      gallery: {
        sourcePositions: galleryVerification.summary.sourcePositions,
        visiblePositions: galleryPhotos.length,
        uniqueVisibleAssetCount: new Set(galleryPhotos.map((photo) => photo.assetId)).size,
        verifiedSourceVariants: galleryVerification.summary.verifiedVariants,
        heldAssetIds: galleryVerification.summary.holds,
        observedRemoteUrlCount: new Set(galleryEvents.map((event) => event.remoteUrl)).size,
        classifiedRemoteOccurrenceCount: galleryEvents.length,
        usageClassifications: galleryClassifications,
        eventSha256: createHash('sha256').update(JSON.stringify(galleryEvents)).digest('hex'),
      },
    },
    images,
  };
}

try {
  const expected = buildProvenance();
  if (print) {
    process.stdout.write(`${JSON.stringify(expected, null, 2)}\n`);
  } else {
    assert(existsSync(provenancePath), `缺少對照檔：${provenancePath}；先執行 --print 審閱候選`);
    const actual = readJson(provenancePath);
    assert(isDeepStrictEqual(actual, expected), '對照檔與目前 dist／來源 manifest 不一致；先執行 --print 比對');
    const summary = expected.summary;
    console.log(`V1 Preview R2 來源對照 PASS：${summary.contentCount} contents／${summary.uniqueAssetCount} assets／${summary.verifiedJpegVariantCount} JPEG variants`);
    console.log(`實際SSR主圖 1、縮圖 ${summary.spacesState.thumbnailCount}；互動可用 ${summary.spacesState.interactiveCount}、無JS文字／連結 ${summary.spacesState.fallbackCount}；R2引用分類 ${JSON.stringify(summary.usageClassifications)}`);
    console.log(`歷史靜態版 16 URL／21 usages／空間頁14 R2用途；現版 unknown ${summary.unknownCount}／ambiguous ${summary.ambiguousCount}／missing local ${summary.missingLocalCount}／missing alt ${summary.missingAltCount}`);
    console.log(`相簿來源 ${summary.gallery.sourcePositions} 位置／顯示 ${summary.gallery.visiblePositions}／待審 ${summary.gallery.heldAssetIds.length}；已分類 ${summary.gallery.classifiedRemoteOccurrenceCount} 次 R2 引用`);
    console.log('已核對16筆 id→asset、48個JPEG變體與原圖 bytes/SHA；serialized props 是互動可用來源，不代表已下載或 Production 供應。');
  }
} catch (error) {
  console.error(`V1 Preview R2 來源對照 FAIL：${error.message}`);
  process.exitCode = 1;
}
