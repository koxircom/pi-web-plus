'use strict';
// Exact static initial-script bytes, separate from variable session/API data.
const fs=require('node:fs'),path=require('node:path'),zlib=require('node:zlib');
const root=path.resolve(__dirname,'..'),html=fs.readFileSync(root+'/.next/server/app/index.html','utf8');
const scripts=[...new Set([...html.matchAll(/src="([^" ]+\.js)"/g)].map(m=>m[1]).filter(p=>p.startsWith('/_next/static/')))];
if(!scripts.some(p=>p.includes('/app/page-')))throw Error('缺少主入口脚本，不能以登录页计算预算');
const initialNextGzipBytes=scripts.reduce((total,p)=>total+zlib.gzipSync(fs.readFileSync(path.join(root,'.next',p.slice('/_next/'.length)))).length,0);
const styles=[...new Set([...html.matchAll(/href="([^" ]+\.css)"/g)].map(m=>m[1]).filter(p=>p.startsWith('/_next/static/')))];
const initialCssGzipBytes=styles.reduce((total,p)=>total+zlib.gzipSync(fs.readFileSync(path.join(root,'.next',p.slice('/_next/'.length)))).length,0);
const manifest=JSON.parse(fs.readFileSync(root+'/enhancements/modules/manifest.json','utf8'));
if(!manifest.runtimeAsset?.path?.match(/^\/pi-web-assets\/enhancements-[a-f0-9]{16}\.js$/))throw Error('缺少实际首屏增强资源指纹');
const enhancement=fs.readFileSync(root+'/public'+manifest.runtimeAsset.path),enhancementGzipBytes=zlib.gzipSync(enhancement).length;
const limits={initialNextGzipBytes:750000,enhancementGzipBytes:600000,initialStaticJsGzipBytes:1350000,initialCssGzipBytes:150000,initialStaticJsCssGzipBytes:1450000};
const measured={initialNextGzipBytes,enhancementGzipBytes,initialCssGzipBytes,initialStaticJsGzipBytes:initialNextGzipBytes+enhancementGzipBytes,initialStaticJsCssGzipBytes:initialNextGzipBytes+enhancementGzipBytes+initialCssGzipBytes};
for(const [key,max]of Object.entries(limits))if(measured[key]>max)throw Error(`首屏包体超预算：${key}=${measured[key]} > ${max}；检查完整库/被替代实现是否重新进入主包`);
console.log(JSON.stringify({status:'passed',buildId:fs.readFileSync(root+'/.next/BUILD_ID','utf8').trim(),gzip:'node:zlib default level, unique initial HTML scripts + enhancement; variable data excluded',limits,enhancementAsset:manifest.runtimeAsset,...measured}));
