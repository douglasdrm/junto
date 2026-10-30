'use strict';
const {invitation,lookup,coverImage,originFor,markup}=require('../server/invite-preview.cjs');
const fs=require('node:fs'),path=require('node:path');
module.exports=async function handler(req,res){
 res.setHeader('Cache-Control','private, no-store, max-age=0');
 res.setHeader('Referrer-Policy','no-referrer');
 res.setHeader('X-Robots-Tag','noindex, nofollow, noarchive');
 res.setHeader('X-Content-Type-Options','nosniff');
 if(!['GET','HEAD'].includes(req.method)){res.setHeader('Allow','GET, HEAD');return res.status(405).end();}
 const link=invitation(req.query);let data={status:'invalid'};
 try{data=await lookup(link);}catch{ /* Generic fallback; never disclose backend errors or tokens. */ }
 if(req.query?.image==='1'){
  const image=data.status==='available'?coverImage(data.cover_image):null;
  const body=image?.data||fs.readFileSync(path.join(__dirname,'../assets/brand/invite-default.png'));
  res.setHeader('Content-Type',image?.data?image.type:'image/png');
  return req.method==='HEAD'?res.status(200).end():res.status(200).send(body);
 }
 let origin;try{origin=originFor(req);}catch{return res.status(400).end();}
 res.setHeader('Content-Type','text/html; charset=utf-8');
 res.setHeader('Content-Security-Policy',"default-src 'none'; script-src 'self'; base-uri 'none'; frame-ancestors 'none'");
 return req.method==='HEAD'?res.status(200).end():res.status(200).send(markup(origin,link,data));
};
