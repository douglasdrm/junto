'use strict';
// Executa cada tests/*.cjs em um processo próprio, a partir da raiz do repositório
// (alguns testes usam caminhos relativos), e resume o resultado.
const {spawnSync}=require('node:child_process');
const fs=require('node:fs');
const path=require('node:path');
const only=process.argv.slice(2);
const files=fs.readdirSync(__dirname).filter(name=>name.endsWith('.cjs')&&(!only.length||only.some(part=>name.includes(part)))).sort();
const failed=[];
for(const name of files){
  const started=Date.now();
  const result=spawnSync(process.execPath,[path.join(__dirname,name)],{cwd:path.resolve(__dirname,'..'),encoding:'utf8',timeout:120000});
  const ok=result.status===0;
  console.log(`${ok?'ok  ':'FAIL'} ${name} (${Date.now()-started} ms)`);
  if(!ok){failed.push(name);process.stdout.write((result.stdout||'')+(result.stderr||'')+(result.error?String(result.error)+'\n':''))}
}
console.log(`\n${files.length-failed.length} de ${files.length} testes passaram.`);
if(!files.length||failed.length)process.exitCode=1;
