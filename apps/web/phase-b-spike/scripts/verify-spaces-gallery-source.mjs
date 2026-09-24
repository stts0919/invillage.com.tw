#!/usr/bin/env node

import { createHash } from 'node:crypto';
import { readFileSync, realpathSync, statSync } from 'node:fs';
import { dirname, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';
import { isDeepStrictEqual } from 'node:util';

const spikeRoot = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const repositoryRoot = resolve(spikeRoot, '../../..');
const realRepositoryRoot = realpathSync(repositoryRoot);

function assert(condition, message) {
  if (!condition) throw new Error(message);
}

function readJson(path) {
  return JSON.parse(readFileSync(resolve(spikeRoot, path), 'utf8'));
}

function checkedFile(relativePath, prefix, bytes, sha256) {
  assert(typeof relativePath === 'string' && relativePath.startsWith(`${prefix}/`), `非法來源路徑：${relativePath}`);
  const path = resolve(repositoryRoot, relativePath);
  assert(path.startsWith(`${repositoryRoot}${sep}`) && realpathSync(path).startsWith(`${realRepositoryRoot}${sep}`), `來源越界：${relativePath}`);
  const contents = readFileSync(path);
  assert(contents.length === bytes && createHash('sha256').update(contents).digest('hex') === sha256, `bytes/SHA 不符：${relativePath}`);
  return contents.toString('utf8');
}

function indexed(rows, key) {
  const index = new Map();
  for (const row of rows) {
    assert(typeof row?.[key] === 'string' && !index.has(row[key]), `重複或缺少 ${key}：${row?.[key]}`);
    index.set(row[key], row);
  }
  return index;
}

function sourcePanes(html) {
  const starts = [...html.matchAll(/<div\b[^>]*\bclass="[^"]*\bw-tab-pane\b[^"]*"[^>]*>/gi)];
  return starts.map((match) => {
    const sourceTab = /\bdata-w-tab="([^"]+)"/i.exec(match[0])?.[1];
    const contentStart = match.index + match[0].length;
    let depth = 1;
    let contentEnd = null;
    for (const tag of html.slice(contentStart).matchAll(/<\/?div\b[^>]*>/gi)) {
      depth += tag[0].startsWith('</') ? -1 : 1;
      if (depth === 0) {
        contentEnd = contentStart + tag.index;
        break;
      }
    }
    assert(contentEnd !== null, `Webflow tab 未關閉：${sourceTab}`);
    const section = html.slice(contentStart, contentEnd);
    const assetIds = [...section.matchAll(/<img\b[^>]*\bsrc="[^"]*\/([0-9a-f]{24})_[^"]*\.jpe?g"[^>]*>/gi)].map((image) => image[1]);
    return { sourceTab, assetIds };
  });
}

export function verifySpacesGallerySource() {
  const manifest = readJson('reference/spaces-gallery.json');
  const content = readJson('reference/spaces-content.json');
  const inventory = indexed(readJson('../../../imports/webflow/manifests/image-inventory.json').images, 'id');
  const downloads = indexed(readJson('../../../imports/webflow/manifests/download-verification.json').files, 'id');
  const optimized = indexed(readJson('../../../assets/manifests/optimization-live.json').images, 'id');
  const r2 = readJson('../../../assets/manifests/r2-upload-preview.json');
  const r2ByPath = indexed(r2.items, 'localPath');
  assert(manifest.schemaVersion === 1 && manifest.sourcePath === 'imports/webflow/site/html/spaces.html', 'gallery manifest 來源錯誤');
  assert(r2.bucketName === 'invillage-media-preview' && r2.publicBaseUrl === 'https://pub-a73a77b87d504498bad6ae568754e572.r2.dev', 'Preview R2 邊界不符');
  const html = checkedFile(manifest.sourcePath, 'imports/webflow/site/html', 92519, manifest.sourceSha256);
  const panes = sourcePanes(html);
  const items = content.groups.flatMap((group) => group.items.map((item) => ({ ...item, kind: group.kind })));
  assert(panes.length === 16 && manifest.galleries.length === 16 && items.length === 16, '不是 6 客房＋10 公共空間');
  const verifiedAssets = new Set();
  const holds = [];
  let positions = 0;
  let visible = 0;
  let variantCount = 0;

  manifest.galleries.forEach((gallery, index) => {
    const item = items[index];
    const pane = panes[index];
    const ids = gallery.photos.map((photo) => photo.assetId);
    assert(gallery.contentId === item.id && gallery.kind === item.kind && gallery.sourceTab === item.sourceTab, `gallery 分類／tab 不符：${item.id}`);
    assert(pane.sourceTab === gallery.sourceTab && isDeepStrictEqual(ids, pane.assetIds), `Webflow 照片順序不符：${item.id}`);
    assert(ids.length === 5 && new Set(ids).size === 5, `來源不是 5 張唯一照片：${item.id}`);
    const first = r2.items.find((upload) => upload.assetId === ids[0] && upload.remoteUrl === item.imageUrl);
    assert(first && first.runtimeEnabled === true, `現行主圖不是來源首張：${item.id}`);
    positions += ids.length;
    gallery.photos.forEach((photo) => {
      assert(typeof photo.scene === 'string' && photo.scene.trim() && !photo.scene.includes('長照'), `scene 缺失或失實：${photo.assetId}`);
      assert(photo.status === undefined || photo.status === 'hold', `未知審核狀態：${photo.assetId}`);
      if (photo.status === 'hold') {
        assert(typeof photo.reason === 'string' && photo.reason.trim(), `hold 缺少原因：${photo.assetId}`);
        holds.push(photo.assetId);
      } else {
        assert(photo.reason === undefined, `顯示圖不應有 hold 原因：${photo.assetId}`);
        visible += 1;
      }
      if (verifiedAssets.has(photo.assetId)) return;
      verifiedAssets.add(photo.assetId);
      const original = inventory.get(photo.assetId);
      const download = downloads.get(photo.assetId);
      const output = optimized.get(photo.assetId);
      assert(original && download && output && output.placement === 'r2', `缺少來源／優化對照：${photo.assetId}`);
      assert(original.localOriginal === download.path && original.localOriginal === output.source.path, `原圖路徑不一致：${photo.assetId}`);
      assert(original.sourceBytes === download.actualBytes && original.sourceBytes === output.source.bytes && download.sha256 === output.source.sha256, `原圖 manifest 不一致：${photo.assetId}`);
      checkedFile(original.localOriginal, 'imports/webflow/assets/images', original.sourceBytes, download.sha256);
      const jpegWidths = [];
      for (const variant of output.outputs) {
        const upload = r2ByPath.get(variant.path);
        assert(upload && upload.assetId === photo.assetId && upload.bytes === variant.bytes && upload.sha256 === variant.sha256 && upload.r2Key === variant.r2Key, `優化／R2 對照不符：${variant.path}`);
        assert(upload.remoteUrl === `${r2.publicBaseUrl}/${upload.r2Key}`, `Preview R2 URL 不符：${variant.path}`);
        checkedFile(variant.path, 'assets/optimized', variant.bytes, variant.sha256);
        if (upload.contentType === 'image/jpeg') {
          assert(upload.runtimeEnabled === true, `JPEG 未啟用：${variant.path}`);
          jpegWidths.push(variant.dimensions.width);
        }
        variantCount += 1;
      }
      assert(jpegWidths.includes(640) && jpegWidths.some((width) => width >= 1280), `缺少可用 JPEG 尺寸：${photo.assetId}`);
    });
  });

  assert(positions === 80 && verifiedAssets.size === 79 && visible === 78 && variantCount === 258, '相簿總數不符');
  assert(isDeepStrictEqual(holds.sort(), ['651d4f6f5a6041010d0df333', '651ec6d7132a2cfb80d4309e'].sort()), '待審圖清單不符');
  return { manifest, summary: { galleries: manifest.galleries.length, sourcePositions: positions, visiblePositions: visible, uniqueAssets: verifiedAssets.size, verifiedVariants: variantCount, holds } };
}

if (process.argv[1] && resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  try {
    const { summary } = verifySpacesGallerySource();
    console.log(`Spaces gallery source PASS：${JSON.stringify(summary)}`);
  } catch (error) {
    console.error(`Spaces gallery source FAIL：${error.message}`);
    process.exitCode = 1;
  }
}
