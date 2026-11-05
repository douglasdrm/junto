const assert=require('node:assert/strict'),fs=require('node:fs');
const source=fs.readFileSync(require('node:path').join(__dirname,'../stage43.js'),'utf8');
const helper=source.slice(source.indexOf('function personMonthlySettlement('),source.indexOf('function buildPersonReport('));
const months=Array.from({length:12},(_,i)=>`2026-${String(i+2).padStart(2,'0')}`).map(m=>m==='2026-13'?'2027-01':m);
let payments=[];
const settle=new Function('planMonths','contributionAllocations','pays','personInstallmentValue',`${helper};return personMonthlySettlement`)(()=>months,()=>payments.flatMap(p=>p.monthAllocations?.length?p.monthAllocations:p.allocations.map(a=>({...a,referenceMonth:p.referenceMonth}))),()=>payments,()=>6000);
function single(person,count){return months.slice(0,count).map(referenceMonth=>({referenceMonth,allocations:[{participantId:person,amountCents:6000}]}))}
payments=[...single('karina',9),...single('rodrigo',8),{referenceMonth:'2026-10',source:{type:'simple-group'},allocations:[{participantId:'karina',amountCents:18000},{participantId:'rodrigo',amountCents:24000}]}];
const original=JSON.stringify(payments);
for(const id of ['karina','rodrigo']){const result=settle(id);assert(result.every(m=>m.paidCents===6000&&m.missingCents===0));assert.equal(result.reduce((s,m)=>s+m.paidCents,0),72000)}
assert.equal(JSON.stringify(payments),original,'must never mutate financial records');assert(settle('other').every(m=>m.paidCents===0));
payments=[...single('karina',9),{referenceMonth:'2026-10',source:{type:'simple-group'},allocations:[{participantId:'karina',amountCents:9001}]}];
assert.deepEqual(settle('karina').slice(9).map(m=>m.paidCents),[6000,3001,0]);
payments[9].allocationMode='credit';assert.deepEqual(settle('karina').slice(9).map(m=>m.paidCents),[0,0,0]);
delete payments[9].allocationMode;payments[9].monthAllocations=[{participantId:'karina',referenceMonth:'2027-01',amountCents:9001}];assert.deepEqual(settle('karina').slice(9).map(m=>m.paidCents),[0,0,9001]);
console.log('PASS collective shares 180/240, all twelve installments, partial cents, beneficiary isolation, explicit credit/month allocations, immutable records');
