#!/usr/bin/env node
import { readFileSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, dirname } from 'node:path';

const siteId = '65009115380adfba3ebe2328';
const flags = Object.fromEntries(process.argv.slice(2).reduce((items, value, index, args) => {
  if (index % 2 === 0) items.push([value.replace(/^--/, ''), args[index + 1]]);
  return items;
}, []));
for (const key of ['assets', 'requirements', 'extra', 'out']) if (!flags[key]) throw new Error('Missing --' + key);
if (existsSync(resolve(flags.out))) throw new Error('Output already exists');
const { assets } = JSON.parse(readFileSync(flags.assets, 'utf8'));
const requirements = JSON.parse(readFileSync(flags.requirements, 'utf8'));
const extra = JSON.parse(readFileSync(flags.extra, 'utf8'));
const byId = new Map(assets.map(asset => [asset.id, asset]));
const imageMappings = [];
const assetUrls = { ...extra.assetUrls };
const records = [];
for (const needed of requirements.imageAssets) {
  const asset = byId.get(needed.assetId);
  if (!asset || asset.siteId !== siteId) throw new Error('Missing managed source ' + needed.assetId);
  const choices = [...asset.variants.filter(v => v.hostedUrl && !v.error && Number.isFinite(v.width)).map(v => ({ width: v.width, url: v.hostedUrl })), { width: needed.source.dimensions.width, url: asset.hostedUrl }].sort((a, b) => a.width - b.width);
  const used = new Set();
  for (const variant of needed.variants) {
    const override=extra.imageVariantOverrides?.[variant.mappingSourceUrl];
    const candidate = override ?? choices.find(c => c.width >= variant.width && !used.has(c.url));
    if (!candidate) throw new Error('Insufficient responsive asset ' + needed.assetId + ' / ' + variant.width);
    if (!Number.isInteger(candidate.width) || candidate.width < variant.width || used.has(candidate.url)) throw new Error('Invalid responsive override');
    const uri = new URL(candidate.url);
    const managedS3 = uri.hostname === 's3.amazonaws.com' && uri.pathname.startsWith('/webflow-prod-assets/' + siteId + '/');
    const managedCdn = uri.hostname === 'cdn.prod.website-files.com' && uri.pathname.startsWith('/' + siteId + '/');
    if (uri.protocol !== 'https:' || uri.search || uri.hash || !(managedS3 || managedCdn)) throw new Error('Unexpected managed URI');
    used.add(candidate.url);
    imageMappings.push({ sourceUrl: variant.mappingSourceUrl, webflowUrl: candidate.url, managedWidth: candidate.width });
    assetUrls[variant.mappingSourceUrl] = candidate.url;
    records.push({ assetId: needed.assetId, sourceWidth: variant.width, managedWidth: candidate.width, url: candidate.url, sourceUrl: variant.mappingSourceUrl });
  }
}
const lookup = (assetId, width) => records.find(r => r.assetId === assetId && r.sourceWidth === width)?.url;
assetUrls['/assets/images/room-401.jpg'] = lookup('651eb5fab873a24649ff0253', 640);
assetUrls['/assets/images/room-402.jpg'] = lookup('651eb6cd024dac289bcccd90', 640);
const heroMap = requirements.heroAssets.map(a => {
  const url = extra.heroUrls[a.assetId];
  if (!url) throw new Error('Missing Hero mapping ' + a.assetId);
  return { assetId: a.assetId, webflowUrl: url };
});
const result = { schemaVersion: 1, siteId, assetUrls, imageMappings, assetMappings: heroMap, imageRecords: records };
const nativePath=resolve(dirname(flags.out), 'native-mapping.json');
const runtimePath=resolve(dirname(flags.out), 'runtime-mapping.json');
if ([nativePath,runtimePath].some(existsSync)) throw new Error('Mapping sidecar already exists');
writeFileSync(resolve(flags.out), JSON.stringify(result, null, 2) + '\n', { flag: 'wx' });
writeFileSync(nativePath, JSON.stringify({schemaVersion:1,siteId,assetUrls,assetWidths:Object.fromEntries(records.map(r=>[r.sourceUrl,r.managedWidth]))},null,2)+'\n',{flag:'wx'});
writeFileSync(runtimePath, JSON.stringify({schemaVersion:1,imageMappings,assetMappings:heroMap},null,2)+'\n',{flag:'wx'});
console.log(JSON.stringify({ images: imageMappings.length, heroes: heroMap.length, nativeUrls: Object.keys(assetUrls).length }));
