#!/usr/bin/env node
import { readFileSync, readdirSync, writeFileSync, existsSync } from 'node:fs';
import { resolve, join } from 'node:path';
const args=process.argv.slice(2);
const mappingPath=args[0],dist=resolve(args[1]??'dist'),out=resolve(args[2]??'designer/generated/component.css');
if(!mappingPath)throw new Error('Usage: create-designer-css.mjs MAPPING DIST NEW_FILE');
if(existsSync(out))throw new Error('Output exists');
const mapping=JSON.parse(readFileSync(mappingPath));
const file=readdirSync(join(dist,'_astro')).find(n=>/^SiteLayout\..*\.css$/.test(n));
if(!file)throw new Error('Main CSS missing');
let css=readFileSync(join(dist,'_astro',file),'utf8');
css=css.replace(/url\((?:"([^"]+)"|'([^']+)'|([^\s)]+))\)/g,(_,a,b,c)=>{
 const source=a??b??c,target=mapping.assetUrls[source];
 if(!target)throw new Error('Unmapped CSS asset '+source);
 return 'url("'+target+'")';
});
css=css.replaceAll(':root',':host');
// A lossless TTF-to-WOFF2 mapping must also declare the actual font format.
css=css.replace(/(url\("[^"\n]+\.woff2"\)\s*)format\("truetype"\)/g,'$1format("woff2")');
css+='\n:host{display:block;font-family:var(--font-body);font-size:1rem;line-height:1.7}.spaces-page{font-family:var(--font-body);font-size:1rem;line-height:1.7}';
writeFileSync(out,css,{flag:'wx'});
console.log(JSON.stringify({file:out,characters:css.length}));
