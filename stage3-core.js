'use strict';

/* Núcleo puro do rateio. Não lê nem grava localStorage. */
(function(root){
  const SCALE=1000000;
  const toUnits=value=>Math.max(0,Math.round((Number(value)||0)*SCALE));
  function ageAt(birthDate,referenceDate){
    if(!/^\d{4}-\d{2}-\d{2}$/.test(birthDate||'')||!/^\d{4}-\d{2}-\d{2}$/.test(referenceDate||''))return null;
    const birth=new Date(birthDate+'T12:00:00Z'),reference=new Date(referenceDate+'T12:00:00Z');
    if(Number.isNaN(+birth)||Number.isNaN(+reference)||birth>reference)return null;
    let age=reference.getUTCFullYear()-birth.getUTCFullYear();
    if(reference.getUTCMonth()<birth.getUTCMonth()||(reference.getUTCMonth()===birth.getUTCMonth()&&reference.getUTCDate()<birth.getUTCDate()))age--;
    return age>=0?age:null;
  }
  function ageRuleFor(age,rules=[]){return age==null?null:rules.find(rule=>age>=Number(rule.minAge||0)&&(rule.maxAge==null||rule.maxAge===''||age<=Number(rule.maxAge)))||null}
  function weightFor(person,trip){
    if(person.contributes===false)return 0;
    if(trip.distributionRule==='equal')return 1;
    if(person.weightOverride===true)return Math.max(0,Number(person.share)||0);
    if(person.participantType==='child'&&person.useAgeRule!==false){
      const rule=ageRuleFor(ageAt(person.birthDate,trip.start),trip.ageRules);
      if(rule)return Math.max(0,Number(rule.weight)||0);
    }
    return Math.max(0,Number(person.share)||0);
  }
  function calculate({budgetCents,people,trip}){
    const budget=Math.max(0,Math.round(Number(budgetCents)||0));
    const rows=people.map((person,index)=>({person,index,weight:weightFor(person,trip),custom:person.contributes===false?null:(Number.isInteger(person.customTargetCents)?person.customTargetCents:null)}));
    const customTotal=rows.reduce((sum,row)=>sum+(row.custom==null?0:row.custom),0);
    if(customTotal>budget)return {ok:false,error:'As metas personalizadas ultrapassam o orçamento.',budgetCents:budget,customTotalCents:customTotal,rows:[]};
    const variable=rows.filter(row=>row.custom==null&&row.weight>0),remaining=budget-customTotal,totalUnits=variable.reduce((sum,row)=>sum+toUnits(row.weight),0);
    if(remaining>0&&!totalUnits)return {ok:false,error:'Não há cotas disponíveis para distribuir o valor restante.',budgetCents:budget,customTotalCents:customTotal,rows:[]};
    const allocations=new Map();let used=0;
    variable.forEach(row=>{const units=toUnits(row.weight),raw=remaining*units/totalUnits,base=Math.floor(raw);allocations.set(row.person.id,{amount:base,remainder:raw-base,index:row.index});used+=base});
    [...allocations.values()].sort((a,b)=>b.remainder-a.remainder||a.index-b.index).slice(0,remaining-used).forEach(item=>item.amount++);
    const result=rows.map(row=>({participantId:row.person.id,weight:row.weight,custom:row.custom!=null,targetCents:row.custom==null?(allocations.get(row.person.id)?.amount||0):row.custom}));
    return {ok:true,budgetCents:budget,customTotalCents:customTotal,totalWeight:variable.reduce((sum,row)=>sum+row.weight,0),rows:result,distributedCents:result.reduce((sum,row)=>sum+row.targetCents,0)};
  }
  root.JuntoRateEngine={ageAt,ageRuleFor,weightFor,calculate};
})(globalThis);
