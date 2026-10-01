#!/usr/bin/env node

import { createHash } from 'node:crypto';
import {
  existsSync,
  lstatSync,
  mkdirSync,
  readFileSync,
  realpathSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { dirname, isAbsolute, join, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

const scriptDirectory = dirname(fileURLToPath(import.meta.url));
const defaultSource = resolve(scriptDirectory, '..');
const defaultCorpus = resolve(scriptDirectory, '../../../..');
const expectedGalleryHolds = new Set([
  '651d4f6f5a6041010d0df333',
  '651ec6d7132a2cfb80d4309e',
]);
const expectedHeroRoles = [
  'desktop-video',
  'mobile-landscape-video',
  'desktop-poster',
  'mobile-landscape-poster',
];
const webflowAssetOrigin = 'https://s3.amazonaws.com';
const webflowAssetPrefix = '/webflow-prod-assets/65009115380adfba3ebe2328/';

function fail(message) {
  throw new Error(message);
}

function assert(condition, message) {
  if (!condition) fail(message);
}

function parseArgs(args) {
  const options = {
    source: defaultSource,
    corpus: defaultCorpus,
    out: null,
    mapping: null,
    inventory: false,
  };
  const seen = new Set();
  const valueFlags = new Set(['--source', '--corpus', '--mapping', '--out']);
  for (let index = 0; index < args.length; index += 1) {
    const flag = args[index];
    if (flag === '--help') {
      options.help = true;
      continue;
    }
    if (flag === '--inventory') {
      if (seen.has(flag)) fail('重複參數：--inventory');
      seen.add(flag);
      options.inventory = true;
      continue;
    }
    if (!valueFlags.has(flag)) fail(`未知參數：${flag}`);
    if (seen.has(flag)) fail(`重複參數：${flag}`);
    seen.add(flag);
    const value = args[index + 1];
    if (!value || value.startsWith('--')) fail(`${flag} 缺少值`);
    options[flag.slice(2)] = value;
    index += 1;
  }
  options.source = resolve(options.source);
  options.corpus = resolve(options.corpus);
  options.out = options.out === null
    ? resolve(options.source, 'generated')
    : resolve(options.out);
  options.mapping = options.mapping === null
    ? null
    : resolve(options.mapping);
  return options;
}

function assertNoSymlinkPath(path, label, allowMissingLeaf = false) {
  const absolute = resolve(path);
  let existing = absolute;
  while (!existsSync(existing)) {
    if (!allowMissingLeaf || dirname(existing) === existing) {
      fail(`${label} 不存在：${path}`);
    }
    existing = dirname(existing);
  }
  const real = realpathSync(existing);
  assert(real === existing, `${label} 路徑包含 symlink：${path}`);
  const info = lstatSync(existing);
  assert(!info.isSymbolicLink(), `${label} 不可為 symlink：${path}`);
  if (allowMissingLeaf && existing !== absolute) {
    assert(info.isDirectory(), `${label} 的父目錄不是資料夾：${existing}`);
  }
  return absolute;
}

function validateRoot(path, label) {
  assertNoSymlinkPath(path, label);
  const info = lstatSync(path);
  assert(info.isDirectory() && !info.isSymbolicLink(), `${label} 必須是一般資料夾：${path}`);
  return path;
}

function safeRelativePath(root, relativePath, label) {
  assert(typeof relativePath === 'string' && relativePath.length > 0, `${label} 缺少路徑`);
  assert(!relativePath.includes('\0') && !relativePath.includes('\\'), `${label} 路徑格式不安全`);
  assert(!isAbsolute(relativePath), `${label} 不可使用絕對路徑：${relativePath}`);
  const parts = relativePath.split('/');
  assert(parts.every((part) => part && part !== '.' && part !== '..'), `${label} 路徑含不安全區段：${relativePath}`);
  const fullPath = resolve(root, ...parts);
  const rel = relative(root, fullPath);
  assert(rel && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel), `${label} 路徑超出來源根目錄：${relativePath}`);
  let current = root;
  for (let index = 0; index < parts.length; index += 1) {
    current = join(current, parts[index]);
    assert(existsSync(current), `${label} 檔案不存在：${relativePath}`);
    const info = lstatSync(current);
    assert(!info.isSymbolicLink(), `${label} 路徑不可經過 symlink：${relativePath}`);
    if (index < parts.length - 1) assert(info.isDirectory(), `${label} 路徑中間節點不是資料夾：${relativePath}`);
    else assert(info.isFile(), `${label} 不是一般檔案：${relativePath}`);
  }
  assert(realpathSync(fullPath) === fullPath, `${label} 實際路徑不安全：${relativePath}`);
  return fullPath;
}

function readJson(root, path, label) {
  const fullPath = safeRelativePath(root, path, label);
  try {
    return JSON.parse(readFileSync(fullPath, 'utf8'));
  } catch (error) {
    fail(`${label} JSON 無法讀取：${error.message}`);
  }
}

function sha256(buffer) {
  return createHash('sha256').update(buffer).digest('hex');
}

function verifiedFile(root, relativePath, expectedBytes, expectedSha, label) {
  const fullPath = safeRelativePath(root, relativePath, label);
  const bytes = readFileSync(fullPath);
  assert(Number.isInteger(expectedBytes) && bytes.byteLength === expectedBytes, `${label} bytes 不符：${relativePath}`);
  assert(/^[a-f0-9]{64}$/i.test(expectedSha) && sha256(bytes) === expectedSha, `${label} SHA-256 不符：${relativePath}`);
  return { fullPath, bytes };
}

function jpegDimensions(buffer, label) {
  assert(buffer.length >= 4 && buffer[0] === 0xff && buffer[1] === 0xd8, `${label} 不是 JPEG`);
  const startOfFrame = new Set([0xc0, 0xc1, 0xc2, 0xc3, 0xc5, 0xc6, 0xc7, 0xc9, 0xca, 0xcb, 0xcd, 0xce, 0xcf]);
  let offset = 2;
  while (offset < buffer.length) {
    while (offset < buffer.length && buffer[offset] !== 0xff) offset += 1;
    while (offset < buffer.length && buffer[offset] === 0xff) offset += 1;
    if (offset >= buffer.length) break;
    const marker = buffer[offset];
    offset += 1;
    if (marker === 0xd9 || marker === 0xda) break;
    if (marker === 0x01 || (marker >= 0xd0 && marker <= 0xd7)) continue;
    assert(offset + 2 <= buffer.length, `${label} JPEG marker 截斷`);
    const segmentLength = buffer.readUInt16BE(offset);
    assert(segmentLength >= 2 && offset + segmentLength <= buffer.length, `${label} JPEG segment 長度錯誤`);
    if (startOfFrame.has(marker)) {
      assert(segmentLength >= 7, `${label} JPEG 尺寸資料截斷`);
      const height = buffer.readUInt16BE(offset + 3);
      const width = buffer.readUInt16BE(offset + 5);
      assert(width > 0 && height > 0, `${label} JPEG 尺寸無效`);
      return { width, height };
    }
    offset += segmentLength;
  }
  fail(`${label} 找不到 JPEG 尺寸`);
}

function mp4Boxes(buffer, start, end, label) {
  const boxes = [];
  let offset = start;
  while (offset + 8 <= end) {
    const size32 = buffer.readUInt32BE(offset);
    const type = buffer.toString('ascii', offset + 4, offset + 8);
    let headerSize = 8;
    let size = size32;
    if (size32 === 1) {
      assert(offset + 16 <= end, `${label} MP4 extended box 截斷`);
      const largeSize = buffer.readBigUInt64BE(offset + 8);
      assert(largeSize <= BigInt(Number.MAX_SAFE_INTEGER), `${label} MP4 box 太大`);
      size = Number(largeSize);
      headerSize = 16;
    } else if (size32 === 0) {
      size = end - offset;
    }
    assert(size >= headerSize && offset + size <= end, `${label} MP4 box 長度錯誤`);
    boxes.push({ type, start: offset, dataStart: offset + headerSize, end: offset + size });
    offset += size;
  }
  assert(offset === end, `${label} MP4 box 邊界錯誤`);
  return boxes;
}

function mp4Dimensions(buffer, label) {
  const topLevel = mp4Boxes(buffer, 0, buffer.length, label);
  const moov = topLevel.find((box) => box.type === 'moov');
  assert(moov, `${label} MP4 缺少 moov`);
  for (const track of mp4Boxes(buffer, moov.dataStart, moov.end, label).filter((box) => box.type === 'trak')) {
    const trackBoxes = mp4Boxes(buffer, track.dataStart, track.end, label);
    const mdia = trackBoxes.find((box) => box.type === 'mdia');
    if (!mdia) continue;
    const handler = mp4Boxes(buffer, mdia.dataStart, mdia.end, label).find((box) => box.type === 'hdlr');
    if (!handler || handler.end - handler.dataStart < 12) continue;
    const handlerType = buffer.toString('ascii', handler.dataStart + 8, handler.dataStart + 12);
    if (handlerType !== 'vide') continue;
    const tkhd = trackBoxes.find((box) => box.type === 'tkhd');
    assert(tkhd && tkhd.end - tkhd.dataStart >= 8, `${label} MP4 video track 缺少 tkhd`);
    const widthFixed = buffer.readUInt32BE(tkhd.end - 8);
    const heightFixed = buffer.readUInt32BE(tkhd.end - 4);
    const width = widthFixed >>> 16;
    const height = heightFixed >>> 16;
    assert(width > 0 && height > 0, `${label} MP4 尺寸無效`);
    return { width, height };
  }
  fail(`${label} 找不到 MP4 video track 尺寸`);
}

function assertHttpsUrl(value, label) {
  assert(typeof value === 'string' && value.length > 0, `${label} URL 缺失`);
  let url;
  try {
    url = new URL(value);
  } catch {
    fail(`${label} 不是有效 URL`);
  }
  assert(url.protocol === 'https:' && !url.username && !url.password, `${label} URL 必須是無憑證 HTTPS`);
  assert(!url.search && !url.hash, `${label} URL 不可含 query 或 fragment`);
  const pathParts = url.pathname.split('/').filter(Boolean);
  assert(pathParts.every((part) => {
    let decoded;
    try {
      decoded = decodeURIComponent(part);
    } catch {
      return false;
    }
    return decoded !== '.' && decoded !== '..' && !decoded.includes('/') && !decoded.includes('\\') && !/[\u0000-\u001f]/.test(decoded);
  }), `${label} URL path 不安全`);
  return url;
}

function validateWebflowUrl(value, label) {
  const url = assertHttpsUrl(value, label);
  const cdnPrefix = '/65009115380adfba3ebe2328/';
  const isS3 = url.origin === webflowAssetOrigin && url.pathname.startsWith(webflowAssetPrefix);
  const isCdn = url.origin === 'https://cdn.prod.website-files.com' && url.pathname.startsWith(cdnPrefix);
  assert(isS3 || isCdn, `${label} 必須使用原專案 Webflow managed asset URL`);
  const filename = url.pathname.slice(isS3 ? webflowAssetPrefix.length : cdnPrefix.length);
  assert(filename.length > 0 && !filename.includes('/'), `${label} 必須是指定 prefix 下的單一檔名`);
  return url.href;
}

function loadInputs(sourceRoot, corpusRoot) {
  const sourcePage = safeRelativePath(sourceRoot, 'src/pages/spaces.astro', 'Spaces Astro source');
  assert(statSync(sourcePage).size > 0, 'Spaces Astro source 是空檔');
  const content = readJson(sourceRoot, 'reference/spaces-content.json', 'Spaces content');
  const gallery = readJson(sourceRoot, 'reference/spaces-gallery.json', 'Spaces gallery');
  const legacy = readJson(sourceRoot, 'reference/legacy-slice.json', 'Legacy slice');
  const imageAlts = readJson(sourceRoot, 'reference/image-alts.json', 'Image alts');
  const provenance = readJson(sourceRoot, 'reference/v1-preview-media-provenance.json', 'Media provenance');
  const r2Preview = readJson(corpusRoot, 'assets/manifests/r2-upload-preview.json', 'R2 upload preview manifest');
  const optimization = readJson(corpusRoot, 'assets/manifests/optimization-live.json', 'Optimization manifest');
  const heroManifest = readJson(corpusRoot, 'assets/manifests/hero-video-candidate-002.json', 'Hero media manifest');

  assert(content.schemaVersion === 1 && Array.isArray(content.groups), 'Spaces content schema 不符');
  assert(gallery.schemaVersion === 1 && Array.isArray(gallery.galleries), 'Spaces gallery schema 不符');
  assert(provenance.schemaVersion === 2 && Array.isArray(provenance.images), 'Spaces media provenance schema 不符');
  assert(r2Preview.schemaVersion === 1 && Array.isArray(r2Preview.items), 'R2 preview manifest schema 不符');
  assert(optimization.schemaVersion === 1 && Array.isArray(optimization.images), 'Optimization manifest schema 不符');
  assert(heroManifest.schemaVersion === 1 && Array.isArray(heroManifest.outputs), 'Hero media manifest schema 不符');
  assert(legacy?.titles?.spaces && legacy?.home?.heroFallbackImage, 'Legacy title or Hero fallback missing');
  assert(provenance.status?.includes('not-production-placement'), 'Provenance must remain marked as local preview evidence');

  const contentSource = safeRelativePath(corpusRoot, content.sourcePath, 'Spaces HTML source snapshot');
  assert(sha256(readFileSync(contentSource)) === content.sourceSha256, 'Spaces HTML source SHA-256 不符');
  const gallerySource = safeRelativePath(corpusRoot, gallery.sourcePath, 'Gallery HTML source snapshot');
  assert(sha256(readFileSync(gallerySource)) === gallery.sourceSha256, 'Gallery HTML source SHA-256 不符');

  const groups = new Map(content.groups.map((group) => [group.kind, group]));
  assert(groups.size === 2 && groups.has('rooms') && groups.has('shared-spaces'), 'Spaces 必須包含 rooms 與 shared-spaces');
  assert(groups.get('rooms').items.length === 6 && groups.get('shared-spaces').items.length === 10, 'Spaces item 數量不符');
  assert(content.groups[0].kind === 'rooms' && content.groups[1].kind === 'shared-spaces', 'Spaces 順序不符');

  const provenanceByContentId = new Map(provenance.images.map((image) => [image.content.id, image]));
  const galleryByContentId = new Map(gallery.galleries.map((item) => [item.contentId, item]));
  assert(provenanceByContentId.size === 16 && galleryByContentId.size === 16, 'Provenance/gallery content count must be 16');
  assert(provenance.summary?.contentCount === 16, 'Provenance content summary must be 16');

  const r2ByAsset = new Map();
  for (const item of r2Preview.items) {
    const items = r2ByAsset.get(item.assetId) ?? [];
    items.push(item);
    r2ByAsset.set(item.assetId, items);
  }
  const optimizedByAsset = new Map(optimization.images.map((image) => [image.id, image]));
  const allContentItems = [...groups.get('rooms').items, ...groups.get('shared-spaces').items];
  const stageAssetIds = new Set(allContentItems.map((item) => provenanceByContentId.get(item.id)?.assetId).filter(Boolean));
  const stageSourcesByAssetId = new Map();
  const allGalleryPositions = gallery.galleries.flatMap((item) => item.photos.map((photo) => ({
    contentId: item.contentId,
    kind: item.kind,
    ...photo,
  })));
  const holds = allGalleryPositions.filter((photo) => photo.status === 'hold');
  const heldIds = new Set(holds.map((photo) => photo.assetId));
  assert(holds.length === 2 && heldIds.size === 2, 'Gallery 必須保留兩張 hold 照片');
  assert([...heldIds].every((assetId) => expectedGalleryHolds.has(assetId)) && [...expectedGalleryHolds].every((assetId) => heldIds.has(assetId)), 'Gallery hold asset IDs changed');
  const visiblePositions = allGalleryPositions.filter((photo) => photo.status !== 'hold');
  const distinctVisibleIds = new Set(visiblePositions.map((photo) => photo.assetId));
  assert(allGalleryPositions.length === 80 && visiblePositions.length === 78 && distinctVisibleIds.size === 77, 'Gallery must have 80 source positions, 78 visible occurrences, and 77 distinct assets');
  assert(provenance.summary?.gallery?.sourcePositions === 80, 'Provenance gallery source position count changed');
  assert(provenance.summary?.gallery?.visiblePositions === 78, 'Provenance visible gallery count changed');
  assert(provenance.summary?.gallery?.uniqueVisibleAssetCount === 77, 'Provenance distinct gallery asset count changed');

  const usesByAsset = new Map();
  const addUse = (assetId, use) => {
    const uses = usesByAsset.get(assetId) ?? [];
    uses.push(use);
    usesByAsset.set(assetId, uses);
  };
  for (const item of allContentItems) {
    const source = provenanceByContentId.get(item.id);
    const sourceGallery = galleryByContentId.get(item.id);
    assert(source && source.content.kind === (item.id.startsWith('room-') ? 'rooms' : 'shared-spaces'), `Missing/mismatched provenance: ${item.id}`);
    assert(sourceGallery && sourceGallery.kind === source.content.kind, `Missing/mismatched gallery: ${item.id}`);
    assert(sourceGallery.photos[0]?.assetId === source.assetId, `Stage image differs from first gallery image: ${item.id}`);
    assert(typeof imageAlts[item.id] === 'string' && imageAlts[item.id].trim(), `Missing image alt: ${item.id}`);
    const stageSources = stageSourcesByAssetId.get(source.assetId) ?? [];
    stageSources.push(source);
    stageSourcesByAssetId.set(source.assetId, stageSources);
    addUse(source.assetId, { type: 'space-stage', contentId: item.id, kind: source.content.kind, label: item.label });
  }
  for (const photo of visiblePositions) {
    addUse(photo.assetId, { type: 'gallery', contentId: photo.contentId, kind: photo.kind, scene: photo.scene });
  }

  const fallback = legacy.home.heroFallbackImage;
  const fallbackAssetId = fallback.sourceAssetId;
  assert(typeof fallbackAssetId === 'string' && /^[a-f0-9]{24}$/i.test(fallbackAssetId), 'Hero fallback asset ID is invalid');
  assert(typeof fallback.localPath === 'string' && typeof fallback.sha256 === 'string', 'Hero fallback manifest entry is incomplete');
  addUse(fallbackAssetId, { type: 'hero-fallback', page: 'home' });

  const previewBase = new URL(r2Preview.publicBaseUrl);
  assert(previewBase.protocol === 'https:' && previewBase.hostname.endsWith('.r2.dev'), 'R2 preview base URL is invalid');
  const imageRecords = [];
  for (const assetId of [...distinctVisibleIds].sort()) {
    const optimizationRecord = optimizedByAsset.get(assetId);
    assert(optimizationRecord?.placement === 'r2', `Missing R2 optimization record: ${assetId}`);
    const sourceRecord = provenance.images.find((image) => image.assetId === assetId);
    const originalRecord = sourceRecord?.original ?? optimizationRecord.source;
    assert(originalRecord?.path && Number.isInteger(originalRecord.bytes) && /^[a-f0-9]{64}$/i.test(originalRecord.sha256), `Missing source provenance: ${assetId}`);
    const originalFile = verifiedFile(corpusRoot, originalRecord.path, originalRecord.bytes, originalRecord.sha256, `Original image ${assetId}`);
    const originalDimensions = jpegDimensions(originalFile.bytes, `Original image ${assetId}`);
    const manifestSource = optimizationRecord.source;
    assert(manifestSource?.path === originalRecord.path && manifestSource.bytes === originalRecord.bytes && manifestSource.sha256 === originalRecord.sha256, `Original image manifest mismatch: ${assetId}`);
    assert(manifestSource.dimensions?.width === originalDimensions.width && manifestSource.dimensions?.height === originalDimensions.height, `Original image dimensions mismatch: ${assetId}`);

    const variants = [];
    const candidates = (r2ByAsset.get(assetId) ?? []).flatMap((item) => {
      const match = /-fallback-w(\d+)\.jpg$/.exec(item.localPath ?? '');
      if (!match || item.runtimeEnabled !== true || item.contentType !== 'image/jpeg') return [];
      return [{ item, width: Number(match[1]) }];
    }).sort((left, right) => left.width - right.width);
    const widths = candidates.map((candidate) => candidate.width);
    assert(widths[0] === 640 && widths.length >= 2 && new Set(widths).size === widths.length, `Gallery JPEG widths invalid for ${assetId}`);
    if (stageAssetIds.has(assetId)) {
      assert([640, 1280, 1920].every((width) => widths.includes(width)), `Stage image missing a required 640/1280/1920 JPEG variant: ${assetId}`);
    }
    for (const { item: upload, width } of candidates) {
      const optimizationOutput = optimizationRecord.outputs.find((item) => item.path === upload.localPath);
      assert(optimizationOutput, `Missing optimization output: ${assetId}/${width}`);
      assert(optimizationOutput.sha256 === upload.sha256 && optimizationOutput.bytes === upload.bytes, `R2/optimization integrity mismatch: ${assetId}/${width}`);
      assert(optimizationOutput.dimensions?.width === width && Number.isInteger(optimizationOutput.dimensions.height), `R2 variant dimensions mismatch: ${assetId}/${width}`);
      assert(upload.r2Key && upload.remoteUrl === `${previewBase.href.replace(/\/$/, '')}/${upload.r2Key}`, `R2 URL/key mismatch: ${assetId}/${width}`);
      const variantFile = verifiedFile(corpusRoot, upload.localPath, upload.bytes, upload.sha256, `JPEG variant ${assetId}/${width}`);
      const dimensions = jpegDimensions(variantFile.bytes, `JPEG variant ${assetId}/${width}`);
      assert(dimensions.width === width && dimensions.height === optimizationOutput.dimensions.height, `JPEG file dimensions mismatch: ${assetId}/${width}`);
      for (const stageSource of stageSourcesByAssetId.get(assetId) ?? []) {
        const provenanceVariant = stageSource.variants.find((item) => item.width === width);
        assert(provenanceVariant, `Missing provenance JPEG variant: ${stageSource.content.id}/${width}`);
        assert(provenanceVariant.remoteUrl === upload.remoteUrl && provenanceVariant.r2Key === upload.r2Key, `Provenance/R2 URL mismatch: ${stageSource.content.id}/${width}`);
        assert(provenanceVariant.optimized?.path === upload.localPath && provenanceVariant.optimized.bytes === upload.bytes && provenanceVariant.optimized.sha256 === upload.sha256, `Provenance/R2 file mismatch: ${stageSource.content.id}/${width}`);
        assert(provenanceVariant.optimized.dimensions?.width === dimensions.width && provenanceVariant.optimized.dimensions?.height === dimensions.height, `Provenance/R2 dimensions mismatch: ${stageSource.content.id}/${width}`);
      }
      const sourceUrl = upload.remoteUrl;
      const parsed = assertHttpsUrl(sourceUrl, `R2 mapping source ${assetId}/${width}`);
      assert(parsed.href === sourceUrl && parsed.hostname === previewBase.hostname, `Unexpected R2 mapping source URL: ${assetId}/${width}`);
      variants.push({
        sourceWidth: width,
        managedWidth: null,
        targetWidth: width,
        path: upload.localPath,
        bytes: upload.bytes,
        sha256: upload.sha256,
        dimensions,
        mappingSourceUrl: sourceUrl,
        webflowUrl: null,
      });
    }
    imageRecords.push({
      assetId,
      source: {
        path: originalRecord.path,
        bytes: originalRecord.bytes,
        sha256: originalRecord.sha256,
        dimensions: originalDimensions,
      },
      semanticUses: usesByAsset.get(assetId) ?? [],
      variants,
    });
  }

  const fallbackRecord = imageRecords.find((image) => image.assetId === fallbackAssetId);
  assert(fallbackRecord, 'Hero fallback is not included in the visible gallery inventory');
  const fallbackVariant = fallbackRecord.variants.find((variant) => variant.sourceWidth === 1280);
  assert(fallbackVariant && fallbackVariant.path === fallback.localPath && fallbackVariant.sha256 === fallback.sha256, 'Hero fallback variant does not match legacy source');

  assert(heroManifest.selection?.useFullSource === true, 'Hero manifest must select the full source');
  const heroOutputs = new Map(heroManifest.outputs.map((output) => [output.role, output]));
  assert(heroOutputs.size === expectedHeroRoles.length && expectedHeroRoles.every((role) => heroOutputs.has(role)), 'Hero manifest roles changed');
  const heroAssetRecords = [];
  for (const role of expectedHeroRoles) {
    const output = heroOutputs.get(role);
    assert(output.path.startsWith('assets/optimized/hero-video/candidate-002/'), `Hero asset path outside candidate-002: ${role}`);
    const file = verifiedFile(corpusRoot, output.path, output.bytes, output.sha256, `Hero ${role}`);
    const dimensions = role.endsWith('video')
      ? mp4Dimensions(file.bytes, `Hero ${role}`)
      : jpegDimensions(file.bytes, `Hero ${role}`);
    const mediaType = role.endsWith('video') ? 'video/mp4' : 'image/jpeg';
    const assetId = `hero-${role}`;
    heroAssetRecords.push({
      assetId,
      role,
      path: output.path,
      bytes: output.bytes,
      sha256: output.sha256,
      dimensions,
      contentType: mediaType,
      mappingKey: assetId,
      webflowUrl: null,
      semanticUses: [{ type: role.endsWith('video') ? 'home-hero-video' : 'home-hero-poster', breakpoint: role.startsWith('mobile') ? 'mobile-landscape' : 'desktop' }],
    });
  }

  return {
    content,
    groups,
    allContentItems,
    galleryByContentId,
    provenanceByContentId,
    imageAlts,
    legacy,
    holds,
    visiblePositions,
    imageRecords,
    heroAssetRecords,
    fallbackAssetId,
    fallbackVariant,
    r2Preview,
  };
}

function readMapping(path) {
  if (!path) return null;
  assertNoSymlinkPath(path, 'Mapping file');
  const info = lstatSync(path);
  assert(info.isFile() && !info.isSymbolicLink(), `Mapping 必須是一般 JSON 檔：${path}`);
  try {
    return JSON.parse(readFileSync(path, 'utf8'));
  } catch (error) {
    fail(`Mapping JSON 無法讀取：${error.message}`);
  }
}

function applyMapping(input, mapping) {
  const sourceWidthByUrl = new Map();
  for (const image of input.imageRecords) {
    for (const variant of image.variants) {
      assert(!sourceWidthByUrl.has(variant.mappingSourceUrl), `Duplicate R2 source URL for image variants: ${image.assetId}`);
      sourceWidthByUrl.set(variant.mappingSourceUrl, variant.sourceWidth);
    }
  }
  const expectedImageUrls = new Set(sourceWidthByUrl.keys());
  const expectedHeroAssets = new Set(input.heroAssetRecords.map((asset) => asset.assetId));
  if (!mapping) {
    return {
      missingImageUrls: [...expectedImageUrls],
      missingHeroAssets: [...expectedHeroAssets],
    };
  }
  assert(mapping.schemaVersion === 1, 'Mapping schemaVersion 必須是 1');
  assert(Array.isArray(mapping.imageMappings) && Array.isArray(mapping.assetMappings), 'Mapping 必須含 imageMappings 與 assetMappings 陣列');
  const imageTargets = new Map();
  for (const [index, item] of mapping.imageMappings.entries()) {
    const keys = item && typeof item === 'object' ? Object.keys(item).sort().join(',') : '';
    assert(keys === 'sourceUrl,webflowUrl' || keys === 'managedWidth,sourceUrl,webflowUrl', 'imageMappings entries require sourceUrl and webflowUrl, with optional managedWidth');
    assert(expectedImageUrls.has(item.sourceUrl), `Mapping contains unknown image source URL at imageMappings[${index}]`);
    assert(!imageTargets.has(item.sourceUrl), `Duplicate image mapping at imageMappings[${index}]`);
    if (Object.hasOwn(item, 'managedWidth')) {
      assert(Number.isSafeInteger(item.managedWidth) && item.managedWidth > 0, `managedWidth at imageMappings[${index}] must be a positive integer`);
      assert(item.managedWidth >= sourceWidthByUrl.get(item.sourceUrl), `managedWidth at imageMappings[${index}] must not be lower than source width`);
    }
    imageTargets.set(item.sourceUrl, {
      webflowUrl: validateWebflowUrl(item.webflowUrl, `Webflow target at imageMappings[${index}]`),
      managedWidth: item.managedWidth ?? null,
    });
  }
  const heroTargets = new Map();
  for (const [index, item] of mapping.assetMappings.entries()) {
    assert(item && typeof item === 'object' && Object.keys(item).sort().join(',') === 'assetId,webflowUrl', 'assetMappings entries require only assetId and webflowUrl');
    assert(expectedHeroAssets.has(item.assetId), `Mapping contains unknown hero asset: ${item.assetId}`);
    assert(!heroTargets.has(item.assetId), `Duplicate hero mapping: ${item.assetId}`);
    heroTargets.set(item.assetId, validateWebflowUrl(item.webflowUrl, `Webflow target at assetMappings[${index}]`));
  }
  const usedTargets = [...imageTargets.values()].map((target) => target.webflowUrl).concat([...heroTargets.values()]);
  assert(new Set(usedTargets).size === usedTargets.length, '不同來源不可共用同一 Webflow asset URL');
  const missingImageUrls = [...expectedImageUrls].filter((url) => !imageTargets.has(url));
  const missingHeroAssets = [...expectedHeroAssets].filter((assetId) => !heroTargets.has(assetId));
  for (const image of input.imageRecords) {
    for (const variant of image.variants) {
      const target = imageTargets.get(variant.mappingSourceUrl);
      variant.webflowUrl = target?.webflowUrl ?? null;
      variant.managedWidth = target?.managedWidth ?? null;
      variant.targetWidth = variant.managedWidth ?? variant.sourceWidth;
    }
    assert(new Set(image.variants.map((variant) => variant.targetWidth)).size === image.variants.length, `Mapped target widths must be unique for ${image.assetId}`);
  }
  for (const asset of input.heroAssetRecords) asset.webflowUrl = heroTargets.get(asset.assetId) ?? null;
  return { missingImageUrls, missingHeroAssets };
}

function makeSpacesData(input) {
  const mapByAssetId = new Map(input.imageRecords.map((image) => [image.assetId, image]));
  const mediaFor = (contentId) => {
    const source = input.provenanceByContentId.get(contentId);
    const image = mapByAssetId.get(source.assetId);
    assert(image, `Missing mapped stage asset: ${source.assetId}`);
    const variantAt = (width) => {
      const variant = image.variants.find((item) => item.sourceWidth === width);
      assert(variant?.webflowUrl, `Missing Webflow URL for ${source.assetId}/${width}`);
      return variant;
    };
    const small = variantAt(640);
    const medium = variantAt(1280);
    const large = variantAt(1920);
    const media = {
      assetId: source.assetId,
      small: small.webflowUrl,
      medium: medium.webflowUrl,
      large: large.webflowUrl,
    };
    if ([small, medium, large].some((variant) => variant.managedWidth !== null)) {
      media.widths = { small: small.targetWidth, medium: medium.targetWidth, large: large.targetWidth };
    }
    return media;
  };
  const galleryFor = (item) => {
    const source = input.galleryByContentId.get(item.id);
    const photos = source.photos.filter((photo) => photo.status !== 'hold').map((photo) => {
      const image = mapByAssetId.get(photo.assetId);
      assert(image, `Missing gallery asset: ${photo.assetId}`);
      return {
        assetId: photo.assetId,
        alt: `${item.label}：${photo.scene}`,
        width: image.source.dimensions.width,
        height: image.source.dimensions.height,
        variants: image.variants.slice().sort((left, right) => left.targetWidth - right.targetWidth).map((variant) => ({ width: variant.targetWidth, url: variant.webflowUrl })),
      };
    });
    assert(photos.length > 0 && photos[0].assetId === input.provenanceByContentId.get(item.id).assetId, `Gallery first photo differs from stage: ${item.id}`);
    return photos;
  };
  const adapt = (items) => items.map((item) => ({
    id: item.id,
    label: item.label,
    panelHeading: item.panelHeading,
    description: item.description,
    imageAlt: input.imageAlts[item.id],
    media: mediaFor(item.id),
    gallery: galleryFor(item),
  }));
  return {
    schemaVersion: 1,
    title: input.legacy.titles.spaces,
    rooms: adapt(input.groups.get('rooms').items),
    sharedSpaces: adapt(input.groups.get('shared-spaces').items),
  };
}

function makeHeroData(input) {
  const assets = new Map(input.heroAssetRecords.map((asset) => [asset.role, asset]));
  const heroAsset = (role) => {
    const item = assets.get(role);
    assert(item?.webflowUrl, `Missing Webflow URL for ${item?.assetId ?? role}`);
    return { assetId: item.assetId, url: item.webflowUrl, contentType: item.contentType, width: item.dimensions.width, height: item.dimensions.height };
  };
  assert(input.fallbackVariant.webflowUrl, 'Missing Webflow URL for Hero fallback');
  return {
    schemaVersion: 1,
    fallback: {
      assetId: input.fallbackAssetId,
      url: input.fallbackVariant.webflowUrl,
      contentType: 'image/jpeg',
      width: input.fallbackVariant.dimensions.width,
      height: input.fallbackVariant.dimensions.height,
    },
    desktop: {
      video: heroAsset('desktop-video'),
      poster: heroAsset('desktop-poster'),
    },
    mobileLandscape: {
      video: heroAsset('mobile-landscape-video'),
      poster: heroAsset('mobile-landscape-poster'),
    },
  };
}

function makeRequirements(input, mappingState) {
  const missingImageUrls = new Set(mappingState.missingImageUrls);
  const missingHeroAssets = new Set(mappingState.missingHeroAssets);
  const imageRecords = input.imageRecords.map((image) => ({
    ...image,
    variants: image.variants.map((variant) => ({
      ...variant,
      mappingStatus: variant.webflowUrl ? 'mapped' : 'missing',
    })),
  }));
  const heroAssets = input.heroAssetRecords.map((asset) => ({
    ...asset,
    mappingStatus: asset.webflowUrl ? 'mapped' : 'missing',
  }));
  const imageUrlCount = new Set(imageRecords.flatMap((image) => image.variants.map((variant) => variant.mappingSourceUrl))).size;
  const allMapped = missingImageUrls.size === 0 && missingHeroAssets.size === 0;
  return {
    schemaVersion: 1,
    status: allMapped ? 'mapped' : 'inventory-needs-webflow-mapping',
    counts: {
      contentItems: input.allContentItems.length,
      gallerySourceOccurrences: input.visiblePositions.length + input.holds.length,
      galleryVisibleOccurrences: input.visiblePositions.length,
      galleryDistinctAssets: imageRecords.length,
      imageVariantFiles: imageRecords.reduce((sum, image) => sum + image.variants.length, 0),
      uniqueImageMappingUrls: imageUrlCount,
      heroFiles: heroAssets.length,
      missingImageMappings: missingImageUrls.size,
      missingHeroMappings: missingHeroAssets.size,
    },
    title: input.legacy.titles.spaces,
    heldGalleryPhotos: input.holds.map((photo) => ({ assetId: photo.assetId, contentId: photo.contentId, reason: photo.reason ?? null })),
    imageAssets: imageRecords,
    heroAssets,
    mappingFormat: {
      schemaVersion: 1,
      imageMappings: {
        requiredFields: ['sourceUrl', 'webflowUrl'],
        optionalFields: ['managedWidth'],
        unknownFields: 'rejected',
        managedWidthRule: 'positive integer greater than or equal to sourceWidth; omit to retain sourceWidth',
      },
      assetMappings: { requiredFields: ['assetId', 'webflowUrl'] },
      webflowUrlPrefix: `${webflowAssetOrigin}${webflowAssetPrefix}`,
    },
  };
}

function validateOutputDirectory(path) {
  const absolute = resolve(path);
  assert(absolute !== dirname(absolute), '--out 不可為 filesystem root');
  try {
    lstatSync(absolute);
    fail(`--out 必須是尚不存在的新資料夾：${absolute}`);
  } catch (error) {
    if (error.code !== 'ENOENT') throw error;
  }
  assertNoSymlinkPath(dirname(absolute), '--out parent');
  const parentInfo = lstatSync(dirname(absolute));
  assert(parentInfo.isDirectory() && !parentInfo.isSymbolicLink(), `--out 的父路徑不是一般資料夾：${dirname(absolute)}`);
  return absolute;
}

function writeOutputs(outPath, outputs) {
  mkdirSync(outPath, { recursive: false });
  for (const [name, value] of Object.entries(outputs)) {
    writeFileSync(join(outPath, name), `${JSON.stringify(value, null, 2)}\n`, { flag: 'wx', mode: 0o644 });
  }
}

function showHelp() {
  console.log([
    '用法：node scripts/build-designer-data.mjs [--source path] [--corpus path] [--mapping file] [--out new-directory] [--inventory]',
    '預設 source 為 phase-b-spike app、corpus 為 script 所在 repo，out 為 source/generated（必須不存在）；資產在另一個 repo 時請顯式指定 --corpus。',
    'Mapping JSON：imageMappings entries allow optional managedWidth (positive integer >= sourceWidth)；assetMappings map Hero files. webflowUrl 僅允許指定 Webflow managed asset S3 prefix。',
    '--inventory 可不提供 mapping，只輸出 asset-requirements.json 並以 0 結束；完整輸出缺 mapping 或有缺項時以 1 結束。',
    'Hero assetId 會列在 asset-requirements.json；image sourceUrl 必須逐筆對應每個實際使用的 R2 variant，sourceWidth 保持原值。',
  ].join('\n'));
}

function main() {
  const options = parseArgs(process.argv.slice(2));
  if (options.help) {
    showHelp();
    return;
  }
  validateRoot(options.source, '--source');
  validateRoot(options.corpus, '--corpus');
  const input = loadInputs(options.source, options.corpus);
  const mapping = readMapping(options.mapping);
  const mappingState = applyMapping(input, mapping);
  const requirements = makeRequirements(input, mappingState);

  if (!options.inventory && !mapping) {
    fail('缺少 --mapping；請先使用 --inventory 產生需求清單，完整模式需要所有 imageMappings 與 assetMappings。');
  }
  if (!options.inventory && (mappingState.missingImageUrls.length || mappingState.missingHeroAssets.length)) {
    const details = [
      `missing imageMappings=${mappingState.missingImageUrls.length}`,
      `missing assetMappings=${mappingState.missingHeroAssets.length}`,
    ].join(', ');
    fail(`Mapping 不完整：${details}。請使用 --inventory 檢視完整需求。`);
  }
  const outPath = validateOutputDirectory(options.out);
  const outputs = options.inventory
    ? { 'asset-requirements.json': requirements }
    : {
      'spaces-data.json': makeSpacesData(input),
      'hero-data.json': makeHeroData(input),
      'asset-requirements.json': requirements,
    };
  for (const name of ['spaces-data.json', 'hero-data.json']) {
    const value = outputs[name];
    if (!value) continue;
    const serialized = JSON.stringify(value);
    assert(!serialized.includes('.r2.dev') && !serialized.includes('/assets/'), `${name} output contains a Preview R2 or local App URL`);
  }
  writeOutputs(outPath, outputs);
  console.log(JSON.stringify({
    mode: options.inventory ? 'inventory' : 'mapped',
    outputDirectory: outPath,
    files: Object.keys(outputs),
    counts: requirements.counts,
  }, null, 2));
}

try {
  main();
} catch (error) {
  console.error(`ERROR: ${error.message}`);
  process.exitCode = 1;
}
