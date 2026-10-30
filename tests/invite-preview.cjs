'use strict';
const assert=require('node:assert/strict');
const {invitation,lookup,coverImage,markup,originFor}=require('../server/invite-preview.cjs');
const handler=require('../api/invite-preview.js');
const token='a'.repeat(64),join=invitation({join:token}),access=invitation({invite:'access:'+token});
assert.equal(join.kind,'join');assert.equal(access.kind,'access');assert.equal(invitation({invite:token}).kind,'invite');
for(const query of [{join:'short'},{join:[token]},{invite:['access:'+token]},{join:token,invite:token},{invite:'javascript:alert(1)'}])assert.equal(invitation(query),null);
const png='data:image/png;base64,'+require('node:fs').readFileSync('assets/brand/invite-default.png').toString('base64');
assert.equal(coverImage(png).type,'image/png');assert.equal(coverImage('data:image/png;base64,PHNjcmlwdD4='),null);assert.equal(coverImage('javascript:alert(1)'),null);assert.equal(coverImage('data:image/svg+xml;base64,PHN2Zz4='),null);assert.equal(coverImage('https://user:secret@example.org/x'),null);
const html=markup('https://junto.example',access,{status:'available',name:'Natal <script>" & família',kind:'evento',cover_image:png});
assert(html.includes('og:image'));assert(html.includes('/api/invite-preview?invite=access%3A'+token+'&amp;image=1'));
assert(html.includes('href="/?invite=access%3A'+token+'"'));assert(html.includes('src="/invite-redirect.js"'));assert(!html.includes('<script>'));assert(html.includes('&lt;script&gt;'));
assert(!markup('https://junto.example',join,{status:'invalid',name:'SECRET',cover_image:png}).includes('SECRET'));
assert.equal(originFor({headers:{host:'novo-dominio.com.br'}}),'https://novo-dominio.com.br');
assert.throws(()=>originFor({headers:{host:'evil.example/"<script>'}}));
function response(){return {headers:{},statusCode:0,body:null,setHeader(k,v){this.headers[k]=v},status(n){this.statusCode=n;return this},send(b){this.body=b;return this},end(){return this}}}
(async()=>{
 let requests=0;
 const fake=async(url,options)=>{requests++;assert(url.endsWith('/rpc/get_invite_social_preview'));assert.deepEqual(JSON.parse(options.body),{raw_token:token,link_kind:'access'});assert(!options.headers.Authorization);return {ok:true,json:async()=>({status:'available',name:'Natal',kind:'evento',cover_image:png,email:'SECRET',payments:[123]})}};
 const data=await lookup(access,fake);assert(!('email'in data));assert(!('payments'in data));assert.equal(requests,1);
 await lookup(null,fake);assert.equal(requests,1);
 const original=global.fetch;global.fetch=fake;
 try{
  let r=response();await handler({method:'GET',headers:{host:'junto.example'},query:{invite:'access:'+token}},r);assert.equal(r.statusCode,200);assert(r.body.includes('Natal'));assert(!r.body.includes('SECRET'));assert.equal(r.headers['Cache-Control'],'private, no-store, max-age=0');
  r=response();await handler({method:'GET',headers:{host:'junto.example'},query:{invite:'access:'+token,image:'1'}},r);assert(Buffer.isBuffer(r.body));assert.equal(r.headers['Content-Type'],'image/png');
  r=response();await handler({method:'GET',headers:{host:'junto.example'},query:{join:'bad'}},r);assert.equal(r.statusCode,200);assert(!r.body.includes('Natal'));
  r=response();await handler({method:'POST',query:{join:token}},r);assert.equal(r.statusCode,405);
  global.fetch=async()=>{throw Error('SECRET service failed')};r=response();await handler({method:'GET',headers:{host:'junto.example'},query:{join:token}},r);assert.equal(r.statusCode,200);assert(!r.body.includes('SECRET'));
 }finally{global.fetch=original}
 console.log('PASS invitation kinds, escaped Open Graph, cover image bytes, brand fallback, new domain, no writes, no private fields, invalid tokens and upstream outage');
})().catch(e=>{console.error(e);process.exitCode=1});
