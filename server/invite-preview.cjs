'use strict';
const fs=require('node:fs'),path=require('node:path');
const escapeHtml=value=>String(value).replace(/[&<>"']/g,c=>({'&':'&amp;','<':'&lt;','>':'&gt;','"':'&quot;',"'":'&#39;'}[c]));
function invitation(query={}){
 const join=query.join,invite=query.invite;
 if(typeof join==='string'&&invite===undefined&&/^[a-f0-9]{64}$/.test(join))return {kind:'join',token:join,key:'join',value:join};
 if(typeof invite!=='string'||join!==undefined)return null;
 if(/^access:[a-f0-9]{64}$/.test(invite))return {kind:'access',token:invite.slice(7),key:'invite',value:invite};
 if(/^[a-f0-9]{64}$/.test(invite))return {kind:'invite',token:invite,key:'invite',value:invite};
 return null;
}
function publicConfig(){
 const source=fs.readFileSync(path.join(__dirname,'../supabase/config.js'),'utf8');
 const url=source.match(/\burl:\s*'([^']+)'/),key=source.match(/\bpublishableKey:\s*'([^']+)'/);
 if(!url||!key)throw Error('Missing public configuration');
 return {url:url[1],key:key[1]};
}
async function lookup(link,fetcher=fetch){
 if(!link)return {status:'invalid'};
 const config=publicConfig(),r=await fetcher(config.url+'/rest/v1/rpc/get_invite_social_preview',{
  method:'POST',headers:{apikey:config.key,'Content-Type':'application/json'},
  body:JSON.stringify({raw_token:link.token,link_kind:link.kind}),signal:AbortSignal.timeout(7000)
 });
 if(!r.ok)throw Error('Preview unavailable');
 const data=await r.json();
 if(data?.status!=='available')return {status:'invalid'};
 return {status:'available',name:String(data.name||'Encontro').slice(0,150),kind:data.kind==='viagem'?'viagem':'evento',cover_image:typeof data.cover_image==='string'?data.cover_image:''};
}
function coverImage(cover){
 if(typeof cover!=='string'||cover.length>2000000)return null;
 const match=cover.match(/^data:image\/(jpeg|png|webp);base64,([A-Za-z0-9+/]+={0,2})$/i);
 if(match){
  const data=Buffer.from(match[2],'base64'),type=match[1].toLowerCase();
  const valid=type==='jpeg'?data[0]===255&&data[1]===216&&data[2]===255:
   type==='png'?data.subarray(0,8).equals(Buffer.from([137,80,78,71,13,10,26,10])):
   data.toString('ascii',0,4)==='RIFF'&&data.toString('ascii',8,12)==='WEBP';
  return valid?{data,type:'image/'+type}:null;
 }
 try{const url=new URL(cover);if(url.protocol==='https:'&&!url.username&&!url.password)return {url:url.href};}catch{}
 return null;
}
function originFor(req){
 // Use the request host, validated by Vercel routing; never trust forwarded-host.
 const configured=process.env.PUBLIC_SITE_URL;
 if(configured){const u=new URL(configured);if(u.protocol==='https:')return u.origin;}
 const host=String(req.headers?.host||process.env.VERCEL_PROJECT_PRODUCTION_URL||'junto-six-eta.vercel.app');
 if(!/^[a-z0-9](?:[a-z0-9.-]*[a-z0-9])?(?::\d{1,5})?$/i.test(host))throw Error('Invalid host');
 return 'https://'+host;
}
function markup(origin,link,data){
 const available=data.status==='available',title=available?`${data.name} | Juntô`:'Convite | Juntô';
 const description=available?`Você recebeu um convite para ${data.kind==='viagem'?'a viagem':'o evento'} “${data.name}”. Abra no Juntô para continuar.`:'Abra o convite no Juntô para conferir sua disponibilidade.';
 const params=link?new URLSearchParams({[link.key]:link.value}).toString():'';
 const target='/'+(params?'?'+params:''),url=origin+'/convite'+(params?'?'+params:'');
 const image=available?coverImage(data.cover_image):null;
 const imageUrl=image?.url||(image?.data?origin+'/api/invite-preview?'+params+'&image=1':origin+'/assets/brand/invite-default.png');
 return `<!doctype html><html lang="pt-BR"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width,initial-scale=1"><meta name="robots" content="noindex,nofollow,noarchive"><meta name="referrer" content="no-referrer"><title>${escapeHtml(title)}</title><meta property="og:type" content="website"><meta property="og:site_name" content="Juntô"><meta property="og:locale" content="pt_BR"><meta property="og:title" content="${escapeHtml(title)}"><meta property="og:description" content="${escapeHtml(description)}"><meta property="og:url" content="${escapeHtml(url)}"><meta property="og:image" content="${escapeHtml(imageUrl)}"><meta property="og:image:alt" content="${escapeHtml(available?'Capa de '+data.name:'Juntô — planeje melhor, viva junto')}"><meta name="twitter:card" content="summary_large_image"><meta name="twitter:image" content="${escapeHtml(imageUrl)}"><script src="/invite-redirect.js" defer></script></head><body><h1>${escapeHtml(title)}</h1><p>${escapeHtml(description)}</p><a href="${escapeHtml(target)}">Abrir no Juntô</a></body></html>`;
}
module.exports={invitation,lookup,coverImage,originFor,markup};
