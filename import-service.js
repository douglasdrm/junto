'use strict';
/* Núcleo independente de importação. Um adaptador XLSX futuro deve converter a
   planilha em linhas normalizadas e então chamar buildDraft. Nenhuma linha é
   persistida por este módulo. */
window.JuntoImport={
  schemaVersion:1,
  requiredFields:['payer','date','referenceMonth','amountCents','allocations','source'],
  fingerprint(row){return [row.trip,row.payer,row.date,row.referenceMonth,row.amountCents,row.source?.sheet,row.source?.row].join('|').toLowerCase()},
  buildDraft(rows,{tripId,people,existingPayments=[]}={}){
    const errors=[],warnings=[],seen=new Set(existingPayments.map(this.fingerprint.bind(this))),payments=[];
    rows.forEach((row,index)=>{
      const line=index+2,amount=Number(row.amountCents),items=Array.isArray(row.allocations)?row.allocations:[],sum=items.reduce((total,item)=>total+Number(item.amountCents||0),0);
      if(!row.payer||!/^\d{4}-\d{2}-\d{2}$/.test(row.date||'')||!/^\d{4}-\d{2}$/.test(row.referenceMonth||'')||!Number.isInteger(amount)||amount<=0)errors.push({line,message:'Pagador, data, mês e valor em centavos são obrigatórios.'});
      if(!items.length)errors.push({line,message:'Alocações ausentes; a importação não pode deduzi-las.'});
      if(sum!==amount)errors.push({line,message:`Alocações (${sum}) diferem do total (${amount}).`});
      items.forEach(item=>{if(!people.some(person=>person.id===item.participantId&&person.trip===tripId))errors.push({line,message:`Participante não encontrado: ${item.participantId}.`})});
      const payment={...row,trip:tripId,source:{type:'xlsx',...row.source},participantIds:items.map(item=>item.participantId)};const key=this.fingerprint(payment);
      if(seen.has(key))warnings.push({line,message:'Possível duplicidade com um pagamento existente.'});else seen.add(key);
      payments.push(payment);
    });
    return {version:1,tripId,payments,errors,warnings,valid:errors.length===0,totals:{rows:rows.length,amountCents:payments.reduce((s,p)=>s+(Number(p.amountCents)||0),0)}};
  }
};
