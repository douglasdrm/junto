'use strict';
(function(root){
  const monthPattern=/^\d{4}-(0[1-9]|1[0-2])$/;
  function monthsBetween(start,end){if(!monthPattern.test(start||'')||!monthPattern.test(end||'')||end<start)return [];const result=[];let [year,month]=start.split('-').map(Number),guard=0;while(guard++<240){const value=`${year}-${String(month).padStart(2,'0')}`;result.push(value);if(value===end)break;if(++month===13){month=1;year++}}return result.at(-1)===end?result:[]}
  function splitCents(total,count){const value=Math.max(0,Math.round(Number(total)||0));if(!count)return [];return Array.from({length:count},(_,index)=>Math.floor(value/count)+(index<value%count?1:0))}
  function dueDate(month,day){if(!day)return '';const [year,value]=month.split('-').map(Number),last=new Date(Date.UTC(year,value,0)).getUTCDate();return `${month}-${String(Math.min(Math.max(1,Number(day)||1),last)).padStart(2,'0')}`}
  function buildPlan({mode,startMonth,endMonth,dueDay,defaultMonthlyCents=0,people=[],monthlyAmounts={},targets={},splitBudget=false}){
    const months=monthsBetween(startMonth,endMonth),competencies=[],goals={};
    if((mode==='monthly'||splitBudget)&&!months.length)return {ok:false,error:'Informe um período mensal válido.'};
    people.forEach(person=>{
      if(person.contributes===false){goals[person.id]=0;return}
      if(mode==='monthly'){
        const monthly=Number.isInteger(monthlyAmounts[person.id])?monthlyAmounts[person.id]:Math.max(0,Math.round(defaultMonthlyCents));goals[person.id]=monthly*months.length;
        months.forEach(month=>competencies.push({participantId:person.id,month,plannedCents:monthly,dueDate:dueDate(month,dueDay)}));
      }else{
        const goal=Math.max(0,Math.round(Number(targets[person.id])||0));goals[person.id]=goal;
        if((mode==='budget'||mode==='custom')&&splitBudget&&months.length)splitCents(goal,months.length).forEach((amount,index)=>competencies.push({participantId:person.id,month:months[index],plannedCents:amount,dueDate:dueDate(months[index],dueDay)}));
      }
    });
    return {ok:true,mode,months,goals,competencies,totalGoalCents:Object.values(goals).reduce((sum,value)=>sum+value,0),totalPlannedCents:competencies.reduce((sum,item)=>sum+item.plannedCents,0)};
  }
  // Divide um valor proporcionalmente aos pesos. Os centavos que sobram vão para quem
  // recebeu menos centavos extras até agora, para que ninguém acumule arredondamentos.
  function splitWeighted(total,ids,weights,extras){
    const value=Math.max(0,Math.round(Number(total)||0)),list=ids.map((id,index)=>({id,index,weight:Math.max(0,Math.round(Number(weights[id]??1)*2))})),sum=list.reduce((acc,item)=>acc+item.weight,0);
    if(!list.length)return {};if(!sum)return Object.fromEntries(list.map(item=>[item.id,0]));
    const parts=Object.fromEntries(list.map(item=>[item.id,Math.floor(value*item.weight/sum)]));let rest=value-Object.values(parts).reduce((acc,item)=>acc+item,0);
    const order=list.filter(item=>item.weight>0).sort((a,b)=>((extras?.[a.id]||0)-(extras?.[b.id]||0))||(a.index-b.index));
    for(let index=0;rest>0&&order.length;index=(index+1)%order.length){parts[order[index].id]+=1;if(extras)extras[order[index].id]=(extras[order[index].id]||0)+1;rest-=1}
    return parts;
  }
  function allocateCosts({people=[],entries=[],groups=[],weightOf=()=>1}){
    const payerIds=[...new Set(people.filter(person=>person&&person.removedFromTrip!==true&&person.contributes!==false).map(person=>person.id))],payerSet=new Set(payerIds),groupMap=new Map(groups.map(group=>[group.id,[...new Set(group.personIds||[])].filter(id=>payerSet.has(id))]));
    const allocations=[],unallocated=[],byPerson=Object.fromEntries(payerIds.map(id=>[id,{plannedCents:0,confirmedCents:0}])),weights=Object.fromEntries(people.filter(person=>payerSet.has(person?.id)).map(person=>[person.id,weightOf(person)])),plannedExtras={},confirmedExtras={};let totalPlannedCents=0,totalConfirmedCents=0;
    entries.forEach((entry,index)=>{
      const plannedCents=Math.max(0,Math.round(Number(entry.plannedCents)||0)),confirmedCents=Math.min(plannedCents,Math.max(0,Math.round(Number(entry.confirmedCents)||0))),participantIds=entry.groupId?groupMap.get(entry.groupId)||[]:payerIds;
      totalPlannedCents+=plannedCents;totalConfirmedCents+=confirmedCents;if(!plannedCents)return;
      if(!participantIds.length){unallocated.push({...entry,plannedCents,confirmedCents});return}
      const plannedParts=splitWeighted(plannedCents,participantIds,weights,plannedExtras),confirmedParts=splitWeighted(confirmedCents,participantIds,weights,confirmedExtras);
      participantIds.forEach(participantId=>{const allocation={sourceId:entry.id||`cost-${index}`,sourceType:entry.sourceType||'expense',category:entry.category||'outros',participantId,plannedCents:plannedParts[participantId]||0,confirmedCents:confirmedParts[participantId]||0};allocations.push(allocation);byPerson[participantId].plannedCents+=allocation.plannedCents;byPerson[participantId].confirmedCents+=allocation.confirmedCents});
    });
    return {allocations,byPerson,unallocated,totalPlannedCents,totalConfirmedCents,allocatedPlannedCents:allocations.reduce((sum,item)=>sum+item.plannedCents,0),allocatedConfirmedCents:allocations.reduce((sum,item)=>sum+item.confirmedCents,0)};
  }
  root.JuntoPlanEngine={monthsBetween,splitCents,splitWeighted,dueDate,buildPlan,allocateCosts};
})(globalThis);
