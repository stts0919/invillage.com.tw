#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { existsSync, readFileSync, readdirSync, statSync } from 'node:fs';
import { basename, dirname, extname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const spikeRoot = resolve(scriptDirectory, '..');
const repositoryRoot = resolve(scriptDirectory, '../../../..');
const manifestPath = resolve(repositoryRoot, 'assets/manifests/hero-video-candidate-002.json');
const routes = ['index', 'spaces', 'plan', 'about', 'contact', '404'];
const localHosts = new Set(['invillage.local', 'invillage.com.tw', 'www.invillage.com.tw']);
const forbiddenWebflowHosts = /(?:cdn\.prod\.website-files\.com|assets\.website-files\.com|uploads-ssl\.webflow\.com|webflowusercontent\.com)/i;
const protocolRelativeR2 = /(?<!:)\/\/[a-z0-9.-]+\.r2\.dev(?=[:/?#\s"'<>)]|$)/i;
const visiblePlaceholder = /(?:待使用者(?:補寫|提供|確認)|待補(?:文案|圖片|內容)|\bTODO\b|\bTBD\b|\bFIXME\b|lorem ipsum|placeholder|測試文案|表單後端.{0,12}(?:未接通|尚未))/i;
const mediaRoles = ['desktop-video', 'mobile-landscape-video', 'desktop-poster', 'mobile-landscape-poster'];

const args = process.argv.slice(2);
if (args.includes('--help')) {
  console.log('用法：node scripts/verify-v1-dist.mjs [--dist /absolute/or/relative/path]');
  process.exit(0);
}
if (args.length !== 0 && (args.length !== 2 || args[0] !== '--dist' || !args[1])) {
  console.error('參數錯誤。用法：node scripts/verify-v1-dist.mjs [--dist path]');
  process.exit(2);
}

const distRoot = args.length ? resolve(args[1]) : resolve(spikeRoot, 'dist');
const failures = new Set();
const pageHtml = new Map();
const remoteImages = new Set();
const stats = { pages: 0, language: 0, h1: 0, noindex: 0, cta: 0, anchors: 0, localLinks: 0, fragments: 0, localAssets: 0, externalAssets: 0, cssUrls: 0, hero: 0 };

function fail(message) {
  failures.add(message);
}

function fileExists(path) {
  try { return statSync(path).isFile(); }
  catch { return false; }
}

function decodeEntities(value) {
  return value.replace(/&(#x[0-9a-f]+|#\d+|amp|quot|apos|lt|gt|nbsp);/gi, (_, entity) => {
    if (entity[0] === '#') {
      const numeric = entity[1]?.toLowerCase() === 'x' ? Number.parseInt(entity.slice(2), 16) : Number.parseInt(entity.slice(1), 10);
      return Number.isInteger(numeric) && numeric >= 0 && numeric <= 0x10ffff ? String.fromCodePoint(numeric) : `&${entity};`;
    }
    return { amp: '&', quot: '"', apos: "'", lt: '<', gt: '>', nbsp: ' ' }[entity.toLowerCase()] ?? `&${entity};`;
  });
}

function attribute(tagAttributes, name) {
  const expression = new RegExp(`(?:^|\\s)${name}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s"'<>]+))`, 'i');
  const match = expression.exec(tagAttributes);
  return match ? decodeEntities(match[1] ?? match[2] ?? match[3]) : null;
}

function openingTags(html, name) {
  return [...html.matchAll(new RegExp(`<${name}\\b([^>]*)>`, 'gi'))].map((match) => match[1]);
}

function withoutInertContent(html) {
  return html
    .replace(/<!--[^]*?-->/g, '')
    .replace(/<script\b[^>]*>[^]*?<\/script>/gi, '')
    .replace(/<style\b[^>]*>[^]*?<\/style>/gi, '');
}

function tagsWithoutBodies(html) {
  return html
    .replace(/<!--[^]*?-->/g, '')
    .replace(/(<script\b[^>]*>)[^]*?<\/script>/gi, '$1</script>')
    .replace(/(<style\b[^>]*>)[^]*?<\/style>/gi, '$1</style>');
}

function insideDist(path) {
  const part = relative(distRoot, path);
  return part === '' || (part !== '..' && !part.startsWith(`..${sep}`) && !isAbsolute(part));
}

function localUrl(raw, basePath, label) {
  const value = decodeEntities(raw).trim();
  if (!value || value === '#') {
    fail(`${label}：空白或 # placeholder URL`);
    return null;
  }
  if (/^(?:javascript|vbscript):/i.test(value)) {
    fail(`${label}：不允許可執行 URL`);
    return null;
  }
  let url;
  try { url = new URL(value, `https://invillage.local${basePath}`); }
  catch {
    fail(`${label}：URL 無法解析`);
    return null;
  }
  if (forbiddenWebflowHosts.test(url.hostname)) fail(`${label}：引用 Webflow CDN 網域`);
  if (!['http:', 'https:'].includes(url.protocol) || !localHosts.has(url.hostname)) return { external: true, url };
  let pathname;
  try { pathname = decodeURIComponent(url.pathname); }
  catch {
    fail(`${label}：URL 編碼無效`);
    return null;
  }
  const fileBase = resolve(distRoot, `.${pathname}`);
  if (!insideDist(fileBase)) {
    fail(`${label}：路徑超出 dist`);
    return null;
  }
  return { external: false, url, pathname, fileBase };
}

function routeFile(fileBase) {
  const options = [fileBase, `${fileBase}.html`, join(fileBase, 'index.html')];
  return options.find((path) => insideDist(path) && fileExists(path)) ?? null;
}

function idsInHtml(path) {
  const source = pageHtml.get(path) ?? readFileSync(path, 'utf8');
  const ids = new Set();
  for (const match of withoutInertContent(source).matchAll(/<[a-z][\w:-]*\b([^>]*)>/gi)) {
    const id = attribute(match[1], 'id');
    if (id) ids.add(id);
  }
  return ids;
}

function checkLink(raw, route) {
  stats.anchors += 1;
  const label = `/${route} href=${JSON.stringify(raw)}`;
  const result = localUrl(raw, `/${route}.html`, label);
  if (!result) return;
  if (result.external) return;
  stats.localLinks += 1;
  const target = routeFile(result.fileBase);
  if (!target) {
    fail(`${label}：站內目標不存在`);
    return;
  }
  if (result.url.hash) {
    let fragment;
    try { fragment = decodeURIComponent(result.url.hash.slice(1)); }
    catch {
      fail(`${label}：anchor 編碼無效`);
      return;
    }
    if (!fragment || extname(target).toLowerCase() !== '.html' || !idsInHtml(target).has(fragment)) {
      fail(`${label}：anchor #${fragment} 不存在`);
      return;
    }
    stats.fragments += 1;
  }
}

function checkAsset(raw, basePath, label, imageCandidate = false) {
  if (/^(?:data|blob):/i.test(raw.trim())) return;
  const result = localUrl(raw, basePath, label);
  if (!result) return;
  if (result.external) {
    stats.externalAssets += 1;
    if (imageCandidate && ['http:', 'https:'].includes(result.url.protocol)) remoteImages.add(result.url.href);
    return;
  }
  stats.localAssets += 1;
  if (!fileExists(result.fileBase)) fail(`${label}：本機資產不存在 (${result.pathname})`);
}

function checkSrcset(value, basePath, label, imageCandidate) {
  if (value.trim().startsWith('data:')) return;
  for (const item of value.split(',')) {
    const url = item.trim().split(/\s+/)[0];
    if (url) checkAsset(url, basePath, label, imageCandidate);
  }
}

function inspectPage(route) {
  const file = resolve(distRoot, `${route}.html`);
  if (!fileExists(file)) {
    fail(`/${route}：缺少 ${route}.html`);
    return;
  }
  stats.pages += 1;
  const html = readFileSync(file, 'utf8');
  pageHtml.set(file, html);
  const visibleHtml = withoutInertContent(html);
  const tagsOnly = tagsWithoutBodies(html);
  const htmlTag = openingTags(visibleHtml, 'html')[0] ?? '';
  if (attribute(htmlTag, 'lang') === 'zh-TW') stats.language += 1;
  else fail(`/${route}：<html lang> 不是 zh-TW`);

  const h1Count = openingTags(visibleHtml, 'h1').length;
  if (h1Count === 1) stats.h1 += 1;
  else fail(`/${route}：H1 數量為 ${h1Count}，預期 1`);

  const robots = openingTags(tagsOnly, 'meta').filter((tag) => attribute(tag, 'name')?.toLowerCase() === 'robots');
  if (robots.length === 1 && /(?:^|[\s,])noindex(?:$|[\s,])/i.test(attribute(robots[0], 'content') ?? '')) stats.noindex += 1;
  else fail(`/${route}：本機 noindex meta 缺失或衝突`);

  const visibleText = decodeEntities(visibleHtml.replace(/<[^>]*>/g, ' ')).replace(/\s+/g, ' ');
  const placeholderMatch = visiblePlaceholder.exec(visibleText);
  if (placeholderMatch) fail(`/${route}：顧客可見的開發 placeholder：${placeholderMatch[0]}`);
  const seenIds = new Set();
  for (const match of tagsOnly.matchAll(/<([a-z][\w:-]*)\b([^>]*)>/gi)) {
    const id = attribute(match[2], 'id');
    if (id !== null) {
      if (seenIds.has(id)) fail(`/${route}：重複 id=${JSON.stringify(id)}（<${match[1].toLowerCase()}>）`);
      seenIds.add(id);
    }
  }
  for (const match of visibleHtml.matchAll(/<[a-z][\w:-]*\b([^>]*)>/gi)) {
    for (const name of ['alt', 'aria-label', 'title', 'placeholder']) {
      const value = attribute(match[1], name);
      const found = value && visiblePlaceholder.exec(value);
      if (found) fail(`/${route}：${name} 含開發 placeholder：${found[0]}`);
    }
  }

  const anchors = [...visibleHtml.matchAll(/<a\b([^>]*)>([^]*?)<\/a>/gi)].map((match) => ({ href: attribute(match[1], 'href'), text: decodeEntities(match[2].replace(/<[^>]*>/g, '')).replace(/\s+/g, ' ').trim() }));
  const messenger = anchors.filter(({ href, text }) =>
    text === '立刻洽詢' || (href && (/^https:\/\/m\.me\//i.test(href) || /facebook\.com\/messages\//i.test(href))));
  if (route === '404') {
    if (messenger.length !== 0) fail('/404：不得出現 Messenger CTA');
  } else if (messenger.length === 1 && messenger[0].href === 'https://m.me/invillagewulai' && messenger[0].text === '立刻洽詢') {
    stats.cta += 1;
  } else {
    fail(`/${route}：Messenger CTA 數量／網址／文字不符（找到 ${messenger.length} 個）`);
  }
  for (const { href } of anchors) if (href !== null) checkLink(href, route);

  for (const [index, tag] of openingTags(tagsOnly, 'img').entries()) {
    if (attribute(tag, 'alt') === null) fail(`/${route}：第 ${index + 1} 個 <img> 缺少 alt 屬性`);
    const src = attribute(tag, 'src');
    const srcset = attribute(tag, 'srcset');
    if (!src && !srcset) fail(`/${route}：img 缺少 src/srcset`);
    if (src) checkAsset(src, `/${route}.html`, `/${route} img`, true);
    if (srcset) checkSrcset(srcset, `/${route}.html`, `/${route} img srcset`, true);
  }
  for (const tag of openingTags(tagsOnly, 'source')) {
    const src = attribute(tag, 'src');
    const srcset = attribute(tag, 'srcset');
    const image = srcset !== null || attribute(tag, 'type')?.startsWith('image/');
    if (!src && !srcset) fail(`/${route}：source 缺少 src/srcset`);
    if (src) checkAsset(src, `/${route}.html`, `/${route} source`, image);
    if (srcset) checkSrcset(srcset, `/${route}.html`, `/${route} source srcset`, true);
  }
  for (const tag of openingTags(tagsOnly, 'video')) {
    const poster = attribute(tag, 'poster');
    if (poster) checkAsset(poster, `/${route}.html`, `/${route} video poster`, true);
  }
  for (const tag of openingTags(tagsOnly, 'script')) {
    const src = attribute(tag, 'src');
    if (src) checkAsset(src, `/${route}.html`, `/${route} script`);
  }
  for (const tag of openingTags(tagsOnly, 'link')) {
    const rel = attribute(tag, 'rel')?.toLowerCase() ?? '';
    const href = attribute(tag, 'href');
    if (href && /\b(?:stylesheet|icon|preload|modulepreload)\b/.test(rel)) checkAsset(href, `/${route}.html`, `/${route} link ${rel}`);
  }
  for (const tag of openingTags(tagsOnly, 'astro-island')) {
    for (const name of ['component-url', 'renderer-url']) {
      const value = attribute(tag, name);
      if (value) checkAsset(value, `/${route}.html`, `/${route} astro-island ${name}`);
    }
  }
}

function walkTextFiles(directory, visit) {
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) walkTextFiles(path, visit);
    else if (entry.isFile() && /\.(?:html|css|js|json)$/i.test(entry.name)) visit(path);
  }
}

function inspectCss(path) {
  const css = readFileSync(path, 'utf8');
  const basePath = `/${relative(distRoot, path).split(sep).join('/')}`;
  for (const match of css.matchAll(/url\(\s*(?:"([^"]*)"|'([^']*)'|([^)]*))\s*\)/gi)) {
    const value = (match[1] ?? match[2] ?? match[3]).trim();
    stats.cssUrls += 1;
    checkAsset(value, basePath, `${basePath} url()`, /\.(?:png|jpe?g|webp|avif|gif|svg)(?:[?#]|$)/i.test(value));
  }
}

function inspectHero() {
  let manifest;
  try { manifest = JSON.parse(readFileSync(manifestPath, 'utf8')); }
  catch {
    fail('Hero candidate-002 manifest 缺失或 JSON 無效');
    return;
  }
  if (manifest.schemaVersion !== 1 || !Array.isArray(manifest.outputs)) {
    fail('Hero manifest schemaVersion/outputs 不符');
    return;
  }
  const astroDirectory = resolve(distRoot, '_astro');
  if (!existsSync(astroDirectory)) {
    fail('缺少 dist/_astro；無法核對 Hero 輸出');
    return;
  }
  const names = readdirSync(astroDirectory);
  const home = pageHtml.get(resolve(distRoot, 'index.html')) ?? '';
  for (const role of mediaRoles) {
    const outputs = manifest.outputs.filter((item) => item.role === role);
    if (outputs.length !== 1 || !outputs[0].path || !/^[0-9a-f]{64}$/i.test(outputs[0].sha256 ?? '')) {
      fail(`Hero ${role}：manifest 缺少唯一 role/path/SHA`);
      continue;
    }
    const item = outputs[0];
    const ext = extname(item.path);
    const stem = basename(item.path, ext);
    const matches = names.filter((name) => (name === `${stem}${ext}` || name.startsWith(`${stem}.`) && name.endsWith(ext)) && fileExists(join(astroDirectory, name)));
    if (matches.length !== 1) {
      fail(`Hero ${role}：dist/_astro 對應檔案數量 ${matches.length}，預期 1`);
      continue;
    }
    const file = resolve(astroDirectory, matches[0]);
    const data = readFileSync(file);
    const sha256 = createHash('sha256').update(data).digest('hex');
    if (sha256 !== item.sha256 || data.length !== item.bytes) {
      fail(`Hero ${role}：輸出 SHA/bytes 與 candidate-002 不符`);
      continue;
    }
    if (!home.includes(`/_astro/${matches[0]}`)) {
      fail(`Hero ${role}：首頁未引用已校驗輸出`);
      continue;
    }
    stats.hero += 1;
  }
}

if (!existsSync(distRoot) || !statSync(distRoot).isDirectory()) {
  console.error(`FAIL：dist 目錄不存在：${distRoot}`);
  process.exit(1);
}
if (!fileExists(resolve(distRoot, 'index.html')) || !existsSync(resolve(distRoot, '_astro'))) {
  console.error(`FAIL：不是完整的 Astro dist（缺少 index.html 或 _astro）：${distRoot}`);
  process.exit(1);
}

for (const route of routes) inspectPage(route);
walkTextFiles(distRoot, (path) => {
  const text = readFileSync(path, 'utf8');
  if (forbiddenWebflowHosts.test(text)) fail(`${relative(distRoot, path)}：含 Webflow CDN 網域`);
  if (protocolRelativeR2.test(path.endsWith('.html') ? decodeEntities(text) : text)) fail(`${relative(distRoot, path)}：不允許協定相對的 Preview R2 URL`);
  if (path.endsWith('.css')) inspectCss(path);
});
inspectHero();

const r2Domains = new Map();
const otherImageDomains = new Map();
for (const address of remoteImages) {
  const host = new URL(address).hostname;
  if (host.endsWith('.r2.dev')) r2Domains.set(host, (r2Domains.get(host) ?? 0) + 1);
  else otherImageDomains.set(host, (otherImageDomains.get(host) ?? 0) + 1);
}
console.log(`V1 dist 靜態驗證：${distRoot}`);
console.log(`頁面 ${stats.pages}/6｜zh-TW ${stats.language}/6｜單一 H1 ${stats.h1}/6｜本機 noindex ${stats.noindex}/6`);
console.log(`Messenger CTA ${stats.cta}/5，404 頁須為 0｜href ${stats.anchors}（站內 ${stats.localLinks}、有效 anchor ${stats.fragments}）｜資產引用：本機 ${stats.localAssets}（含 CSS url() ${stats.cssUrls}）、外部 ${stats.externalAssets}`);
console.log(`Hero candidate-002 SHA/bytes ${stats.hero}/4`);
console.log(`遠端圖片 ${remoteImages.size} 個唯一 URL；Preview R2：${[...r2Domains.entries()].map(([host, count]) => `${host} ${count}`).join('、') || '無'}；其他域名：${[...otherImageDomains.entries()].map(([host, count]) => `${host} ${count}`).join('、') || '無'}`);
console.log('外部圖片只統計 URL 與域名，未連線、未驗證圖片可用；也不證明 dist 與目前 src 同步。此 noindex 規則僅適用本機候選，不得直接沿用到正式版。');
if (failures.size) {
  console.error(`FAIL ${failures.size} 項：`);
  for (const failure of failures) console.error(`- ${failure}`);
  process.exitCode = 1;
} else {
  console.log('PASS：靜態契約無失敗項。');
}
