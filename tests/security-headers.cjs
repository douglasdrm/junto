// Mantém a CSP do vercel.json coerente com o que o index.html carrega.
const assert=require('node:assert/strict');
const fs=require('node:fs');
const path=require('node:path');
const root=path.resolve(__dirname,'..');
const vercel=JSON.parse(fs.readFileSync(path.join(root,'vercel.json'),'utf8'));
const global=vercel.headers.find(rule=>rule.source==='/(.*)');
assert(global,'vercel.json precisa de cabeçalhos para todas as rotas');
const headers=Object.fromEntries(global.headers.map(item=>[item.key.toLowerCase(),item.value]));
for(const key of ['content-security-policy','x-content-type-options','x-frame-options','referrer-policy'])assert(headers[key],`falta o cabeçalho ${key}`);
const csp=Object.fromEntries(headers['content-security-policy'].split(';').map(part=>part.trim().split(/\s+/)).map(([name,...values])=>[name,values]));

assert.deepEqual(csp['script-src'],["'self'"],'scripts só do próprio site: sem CDN, inline ou eval');
assert.deepEqual(csp['frame-ancestors'],["'none'"]);
assert.deepEqual(csp['object-src'],["'none'"]);

const config=fs.readFileSync(path.join(root,'supabase/config.js'),'utf8');
const supabaseUrl=new URL(config.match(/\burl:\s*'([^']+)'/)[1]);
assert(csp['connect-src'].includes(supabaseUrl.origin),'connect-src precisa liberar a URL do Supabase de supabase/config.js');
assert(csp['connect-src'].includes('wss://'+supabaseUrl.host),'connect-src precisa liberar o realtime do Supabase');

const html=fs.readFileSync(path.join(root,'index.html'),'utf8');
const scripts=[...html.matchAll(/<script\b([^>]*)>/g)].map(match=>match[1]);
for(const attrs of scripts){
 const src=attrs.match(/\bsrc="([^"]+)"/)?.[1];
 if(!src){assert(/type="application\/ld\+json"/.test(attrs),'script inline seria bloqueado pela CSP');continue}
 assert(!/^(https?:)?\/\//.test(src),`script externo seria bloqueado pela CSP: ${src}`);
 assert(fs.existsSync(path.join(root,src.split('?')[0])),`script não encontrado: ${src}`);
}
console.log('security-headers ok');
