#!/usr/bin/env node
/** Build a local, read-only Designer import action plan from a verified package. */
import { createHash } from 'node:crypto';
import { lstatSync, readFileSync, realpathSync, writeFileSync } from 'node:fs';
import { dirname, isAbsolute, join, parse, relative, resolve, sep } from 'node:path';
import { fileURLToPath } from 'node:url';

import { parseHtml, serialize } from './package-designer-pages.mjs';
import { verifyDesignerPackage } from './verify-designer-package.mjs';

const SCRIPT = fileURLToPath(import.meta.url);
const DEFAULT_DIST = resolve(dirname(SCRIPT), '../dist');
const SITE_ID = '65009115380adfba3ebe2328';
const ROUTES = new Map([
  ['/', 'index'], ['/spaces', 'spaces'], ['/plan', 'plan'],
  ['/about', 'about'], ['/contact', 'contact'], ['/404', '404'],
]);

const fail = (message) => { throw new Error(message); };
const sha256 = (value) => createHash('sha256').update(value).digest('hex');
const attr = (node, name) => new Map(node.attrs ?? []).get(name);
const inside = (root, path) => {
  const rel = relative(root, path);
  return rel !== '' && rel !== '..' && !rel.startsWith(`..${sep}`) && !isAbsolute(rel);
};
const overlaps = (left, right) => left === right || inside(left, right) || inside(right, left);

function rejectTraversal(value, label) {
  if (typeof value !== 'string' || !value.trim() || value.includes('\0')) fail(`${label} is required`);
  if (value.split(/[\\/]+/).includes('..')) fail(`${label} must not contain path traversal`);
}

function inspectPathComponents(path, label, { allowMissingFinal = false } = {}) {
  const absolute = resolve(path);
  const root = parse(absolute).root;
  const parts = relative(root, absolute).split(sep).filter(Boolean);
  let cursor = root;
  for (let index = 0; index < parts.length; index++) {
    cursor = join(cursor, parts[index]);
    const final = index === parts.length - 1;
    let info;
    try { info = lstatSync(cursor); }
    catch (error) {
      if (allowMissingFinal && final && error.code === 'ENOENT') continue;
      fail(`${label} path component is missing or unreadable`);
    }
    if (info.isSymbolicLink()) fail(`${label} symlink is not allowed`);
    if (!final && !info.isDirectory()) fail(`${label} parent component is not a directory`);
    if (final && allowMissingFinal) fail(`${label} already exists; refusing to overwrite`);
  }
  return absolute;
}

function regularDirectory(argument, label) {
  rejectTraversal(argument, label);
  const path = inspectPathComponents(argument, label);
  const info = lstatSync(path);
  if (!info.isDirectory() || realpathSync(path) !== path) fail(`${label} must be a canonical regular directory`);
  return path;
}

function safeRead(root, name, label) {
  if (typeof name !== 'string' || !name || isAbsolute(name) || /[\\\0?#]/.test(name)) fail(`${label} has an unsafe relative path`);
  const parts = name.split('/');
  if (parts.some((part) => !part || part === '.' || part === '..')) fail(`${label} has a path traversal segment`);
  let path = root;
  for (const [index, part] of parts.entries()) {
    path = join(path, part);
    let info;
    try { info = lstatSync(path); } catch { fail(`${label} file is missing or unreadable: ${name}`); }
    if (info.isSymbolicLink()) fail(`${label} symlink is not allowed: ${name}`);
    if (index < parts.length - 1 && !info.isDirectory()) fail(`${label} path parent is not a directory: ${name}`);
    if (index === parts.length - 1 && !info.isFile()) fail(`${label} must be a regular file: ${name}`);
  }
  return readFileSync(path);
}

function parseArgs(args) {
  const options = {};
  const names = new Map([
    ['--package-dir', 'packageDir'], ['--route', 'route'], ['--out', 'out'],
  ]);
  for (let index = 0; index < args.length; index++) {
    const flag = args[index];
    if (flag === '--help') {
      console.log('node scripts/prepare-designer-import.mjs --package-dir DIR --route ROUTE --out NEW_FILE\nLocal action plan only; no Webflow writes or network calls.');
      return null;
    }
    const key = names.get(flag);
    if (!key || options[key] !== undefined) fail(`Unknown or duplicate argument: ${flag}`);
    const value = args[++index];
    if (!value || value.startsWith('--')) fail(`Missing value for ${flag}`);
    options[key] = value;
  }
  for (const key of ['packageDir', 'route', 'out']) if (options[key] === undefined) fail(`--${key.replace(/[A-Z]/g, (letter) => `-${letter.toLowerCase()}`)} is required`);
  if (!ROUTES.has(options.route)) fail(`Unsupported route: ${options.route}`);
  rejectTraversal(options.packageDir, '--package-dir');
  rejectTraversal(options.out, '--out');
  if (!options.out.toLowerCase().endsWith('.json')) fail('--out must be a new .json file');
  return options;
}

function validateOutputPath(argument, packageRoot, distRoot) {
  const path = resolve(inspectPathComponents(argument, '--out', { allowMissingFinal: true }));
  const parent = dirname(path);
  if (!lstatSync(parent).isDirectory() || realpathSync(parent) !== parent) fail('--out parent must be an existing canonical directory');
  if (overlaps(path, packageRoot) || overlaps(path, distRoot)) fail('--out must be separate from the package and renderer source');
  return path;
}

function walkWithPaths(root) {
  const entries = [];
  function walk(parent, parentPath) {
    const sameTagIndex = new Map();
    for (const child of parent.children ?? []) {
      if (!child.tag) continue;
      const index = (sameTagIndex.get(child.tag) ?? 0) + 1;
      sameTagIndex.set(child.tag, index);
      const path = `${parentPath}/${child.tag}[${index}]`;
      entries.push({ node: child, path });
      walk(child, path);
    }
  }
  walk(root, '');
  return entries;
}

function nodeSnapshot(node) {
  if (node.text !== undefined) return { type: 'text', text: node.text };
  return {
    type: 'element',
    tag: node.tag,
    attributes: (node.attrs ?? []).map(([name, value]) => ({ name, value })),
    children: (node.children ?? []).map(nodeSnapshot),
  };
}

function attributeObject(node) {
  return Object.fromEntries((node.attrs ?? []).map(([name, value]) => [name, value]));
}

function packageRecord(manifest, path, expectedKind) {
  const matches = manifest.files.filter((record) => record.path === path);
  if (matches.length !== 1) fail(`Expected one package manifest record for ${path}`);
  const record = matches[0];
  if (expectedKind && record.kind !== expectedKind) fail(`Unexpected package file kind for ${path}`);
  return record;
}

function readPackageText(packageRoot, manifest, path, expectedKind) {
  const record = packageRecord(manifest, path, expectedKind);
  const bytes = safeRead(packageRoot, path, 'Package');
  const content = bytes.toString('utf8');
  if (!Buffer.from(content, 'utf8').equals(bytes)) fail(`Package file is not valid UTF-8: ${path}`);
  if (bytes.length !== record.bytes || content.length !== record.characters || sha256(bytes) !== record.sha256) {
    fail(`Package file hash/size mismatch: ${path}`);
  }
  return { record, content };
}

function makeButtonReplacement(button) {
  const attrs = attributeObject(button.node);
  const attributes = (button.node.attrs ?? []).map(([name, value]) => ({ name, value }));
  const settingsAttributes = attributes.filter(({ name }) => name !== 'class');
  const children = (button.node.children ?? []).map(nodeSnapshot);
  const innerHtml = (button.node.children ?? []).map(serialize).join('');
  return {
    sourcePath: button.path,
    sourceTag: 'button',
    sourceAttributes: attributes,
    sourceClassNames: (attrs.class ?? '').split(/\s+/).filter(Boolean),
    sourceInnerHtml: innerHtml,
    expectedWhtmlMismatch: 'Only if live readback shows this source button was imported as a Link.',
    remoteIdsGuessed: false,
    operations: [
      { operation: 'create DOM', captureReturnedIdAs: 'createdButtonId' },
      { operation: 'set_tag', id: 'createdButtonId', static_value: 'button' },
      { operation: 'set_style', id: 'createdButtonId', style_names: (attrs.class ?? '').split(/\s+/).filter(Boolean) },
      {
        operation: 'set_settings',
        operations: [{
          element_id: 'createdButtonId',
          settings: [{
            key: 'attributes',
            attributes: settingsAttributes.map(({ name, value }) => ({ name_static: name, value_static: value ?? '' })),
          }],
        }],
      },
      { operation: 'insert children', id: 'createdButtonId', childNodes: children },
      {
        operation: 'read back and compare',
        id: 'createdButtonId',
        expectedTag: 'button',
        expectedStyleNames: (attrs.class ?? '').split(/\s+/).filter(Boolean),
        expectedCustomAttributes: settingsAttributes,
        expectedInnerHtml: innerHtml,
      },
      { operation: 'delete exact self-created Link', id: 'importedLinkIdFromLiveReadback', onlyAfterCreatedButtonReadbackPasses: true },
    ],
  };
}

function buildPlan(options) {
  const packageRoot = regularDirectory(options.packageDir, '--package-dir');
  const distRoot = regularDirectory(DEFAULT_DIST, 'renderer dist');
  const output = validateOutputPath(options.out, packageRoot, distRoot);

  // This existing verifier checks site/schema, fixtureOnly, the packager source
  // hash, every renderer input hash, all package file hashes, and path safety.
  const verification = verifyDesignerPackage({ packageDir: packageRoot, dist: distRoot });
  if (verification.status !== 'PASS') fail('Designer package verification did not pass');

  const manifestBytes = safeRead(packageRoot, 'package-manifest.json', 'Package manifest');
  const manifest = JSON.parse(manifestBytes.toString('utf8'));
  if (manifest.schemaVersion !== 1 || manifest.siteId !== SITE_ID) fail('Package is not for the original Invillage site');
  if (manifest.fixtureOnly !== false || manifest.mappingComplete !== true || manifest.readyForImportTrial !== true) {
    fail('Package is fixture-only or is not a mapped import-trial package');
  }

  const slug = ROUTES.get(options.route);
  const routeMatches = manifest.routes.filter((record) => record.slug === slug && record.route === options.route);
  if (routeMatches.length !== 1) fail(`Expected one manifest route for ${options.route}`);
  const route = routeMatches[0];
  const expectedNativePath = `pages/${slug}.html`;
  if (route.native !== expectedNativePath) fail(`Route native file must be ${expectedNativePath}`);
  const native = readPackageText(packageRoot, manifest, route.native, 'native-page');
  if (native.record.route !== options.route) fail(`Native page route metadata mismatch for ${options.route}`);
  const tree = parseHtml(native.content);
  const entries = walkWithPaths(tree);

  const classes = [...new Set(entries.flatMap(({ node }) => (attr(node, 'class') ?? '').split(/\s+/).filter(Boolean)))].sort();
  const knownClassNames = new Set(Object.values(manifest.names?.classes ?? {}));
  for (const name of classes) {
    if (!/^iv1-[a-zA-Z_][\w-]*$/.test(name) || !knownClassNames.has(name)) fail(`HTML class is not declared in the package registry: ${name}`);
  }
  const classRegistryCss = classes.map((name) => `.${name}{box-sizing:border-box}`).join('\n');

  const buttons = entries.filter(({ node }) => node.tag === 'button').map((button) => ({
    path: button.path,
    attrs: attributeObject(button.node),
    attributes: (button.node.attrs ?? []).map(([name, value]) => ({ name, value })),
    innerHtml: (button.node.children ?? []).map(serialize).join(''),
    classNames: (attr(button.node, 'class') ?? '').split(/\s+/).filter(Boolean),
    childNodes: (button.node.children ?? []).map(nodeSnapshot),
  }));

  const codeComponentNodes = entries.filter(({ node }) => attr(node, 'data-iv1-code-component-slot') !== undefined);
  const componentImageAssets = [];
  const codeComponents = (route.integrations ?? []).map((integration) => {
    const match = /^\[data-iv1-code-component-slot="([^"]+)"\]$/.exec(integration.selector ?? '');
    if (!match) fail(`Unsupported Code Component selector in manifest: ${integration.component}`);
    const slotName = match[1];
    const matches = codeComponentNodes.filter(({ node }) => attr(node, 'data-iv1-code-component-slot') === slotName);
    if (matches.length !== 1) fail(`Expected one native Code Component slot for ${slotName}`);
    const result = { ...integration, slot: slotName, path: matches[0].path, slotAttributes: attributeObject(matches[0].node) };
    if (integration.component === 'SpacesExplorer') {
      const dataFile = readPackageText(packageRoot, manifest, integration.data, 'code-component-data');
      const data = JSON.parse(dataFile.content);
      for (const collection of ['sharedSpaces', 'rooms']) {
        if (!Array.isArray(data[collection])) fail(`Invalid SpacesExplorer data collection: ${collection}`);
        for (const item of data[collection]) {
          for (const role of ['small', 'medium', 'large']) {
            const src = item.media?.[role];
            if (typeof src !== 'string' || typeof item.imageAlt !== 'string') fail(`Missing stage image source/alt for ${item.id}/${role}`);
            componentImageAssets.push({
              dataFile: integration.data,
              collection,
              itemId: item.id,
              assetId: item.media.assetId,
              role: `stage-${role}`,
              src,
              alt: item.imageAlt,
              matchingSourceUrlSha256: manifest.assetMappings.filter((mapping) => mapping.target === src).map((mapping) => mapping.sourceUrlSha256).sort(),
            });
          }
          if (!Array.isArray(item.gallery)) fail(`Missing SpacesExplorer gallery for ${item.id}`);
          for (const photo of item.gallery) {
            if (typeof photo.alt !== 'string' || !Array.isArray(photo.variants)) fail(`Invalid gallery photo data for ${photo.assetId}`);
            for (const variant of photo.variants) {
              if (typeof variant.url !== 'string') fail(`Missing gallery image URL for ${photo.assetId}`);
              componentImageAssets.push({
                dataFile: integration.data,
                collection,
                itemId: item.id,
                assetId: photo.assetId,
                role: 'gallery',
                variantWidth: variant.width,
                src: variant.url,
                alt: photo.alt,
                matchingSourceUrlSha256: manifest.assetMappings.filter((mapping) => mapping.target === variant.url).map((mapping) => mapping.sourceUrlSha256).sort(),
              });
            }
          }
        }
      }
      result.dataCharacters = dataFile.record.characters;
      result.dataSha256 = dataFile.record.sha256;
    }
    return result;
  });
  if (codeComponents.length !== codeComponentNodes.length) fail('Unmatched Code Component slot in native HTML');

  const htmlEmbeds = entries.filter(({ node }) => attr(node, 'data-iv1-embed-slot') !== undefined).map(({ node, path }) => {
    const embedPath = attr(node, 'data-iv1-embed-slot');
    const { record, content } = readPackageText(packageRoot, manifest, embedPath, 'noscript-embed');
    if (record.route !== options.route) fail(`HTML Embed slot route mismatch: ${embedPath}`);
    const embedImages = walkWithPaths(parseHtml(content)).filter(({ node: embedNode }) => embedNode.tag === 'img').map(({ node: embedNode, path: imagePath }) => {
      const src = attr(embedNode, 'src');
      const alt = attr(embedNode, 'alt');
      if (typeof src !== 'string' || typeof alt !== 'string') fail(`Embed image must retain literal src and alt attributes at ${embedPath}${imagePath}`);
      return {
        path: imagePath,
        src,
        alt,
        srcset: attr(embedNode, 'srcset') ?? null,
        matchingSourceUrlSha256: manifest.assetMappings.filter((mapping) => mapping.target === src).map((mapping) => mapping.sourceUrlSha256).sort(),
      };
    });
    return { slotPath: path, embedFile: embedPath, characters: record.characters, sha256: record.sha256, images: embedImages };
  });

  const images = entries.filter(({ node }) => node.tag === 'img').map(({ node, path }) => {
    const src = attr(node, 'src');
    const alt = attr(node, 'alt');
    if (typeof src !== 'string' || typeof alt !== 'string') fail(`Image must retain literal src and alt attributes at ${path}`);
    const sourceHashes = manifest.assetMappings.filter((mapping) => mapping.target === src).map((mapping) => mapping.sourceUrlSha256).sort();
    return { path, src, alt, srcset: attr(node, 'srcset') ?? null, matchingSourceUrlSha256: sourceHashes };
  });

  const headFragments = (route.head ?? []).map((path) => {
    if (!path.startsWith('head/')) fail(`Route head reference is outside head/: ${path}`);
    const { record } = readPackageText(packageRoot, manifest, path);
    if (record.characters >= manifest.maxFragmentCharactersExclusive || record.characters >= 50_000) fail(`Head fragment exceeds the exclusive character limit: ${path}`);
    return {
      path,
      kind: record.kind,
      characters: record.characters,
      bytes: record.bytes,
      sha256: record.sha256,
      fragmentCharacterLimitExclusive: manifest.maxFragmentCharactersExclusive,
      remainingPackageCharactersBeforeExclusiveLimit: manifest.maxFragmentCharactersExclusive - 1 - record.characters,
      existingWebflowHeadCodeUsageKnown: false,
    };
  });

  const plan = {
    schemaVersion: 1,
    planOnly: true,
    remoteWebflowWrites: false,
    route: options.route,
    source: {
      packageManifestSha256: sha256(manifestBytes),
      packageDirectory: packageRoot,
      packageManifestPath: 'package-manifest.json',
      sourcePackagerSha256Verified: manifest.scriptSha256,
      rendererInputCountVerified: manifest.inputs.length,
      nativeHtmlPath: route.native,
      nativeHtmlSha256: native.record.sha256,
      sourceHashesVerifiedAgainstSiblingRendererDist: true,
    },
    originalHtml: native.content,
    classPreservation: {
      sourceClasses: classes,
      classRegistryCss,
      ruleTemplate: '.iv1-name{box-sizing:border-box}',
      readbackRequirement: 'After WHTML import, compare every native HTML class token with Designer readback; this local plan does not prove remote class retention.',
    },
    buttons,
    nativeDomReplacements: buttons.map((button) => makeButtonReplacement({
      path: button.path,
      node: entries.find((entry) => entry.path === button.path).node,
    })),
    codeComponents,
    htmlEmbeds,
    componentImageAssets,
    images,
    headFragments: {
      fragments: headFragments,
      fragmentCharacterLimitExclusive: manifest.maxFragmentCharactersExclusive,
      combinedWithExistingWebflowHeadUsageVerified: false,
    },
    constraints: {
      remoteIdsGuessed: false,
      importedHtmlCopyChanged: false,
      remoteAssetIdentityReadbackVerified: false,
      designerImportReadbackVerified: false,
    },
  };
  return { plan, output };
}

function main(args) {
  const options = parseArgs(args);
  if (!options) return;
  const { plan, output } = buildPlan(options);
  const content = `${JSON.stringify(plan, null, 2)}\n`;
  writeFileSync(output, content, { flag: 'wx', mode: 0o600 });
  console.log(JSON.stringify({ status: 'PASS', planOnly: true, route: plan.route, out: output, sha256: sha256(content), buttons: plan.buttons.length, images: plan.images.length, codeComponents: plan.codeComponents.length, htmlEmbeds: plan.htmlEmbeds.length }, null, 2));
}

if (process.argv[1] && resolve(process.argv[1]) === SCRIPT) {
  try { main(process.argv.slice(2)); }
  catch (error) {
    console.error(JSON.stringify({ status: 'FAIL', planWritten: false, error: error.message }));
    process.exitCode = 1;
  }
}
