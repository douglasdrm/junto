'use strict';
(function(root){
  const monthPattern=/^\d{4}-(0[1-9]|1[0-2])$/;
  function monthsBetween(start,end){if(!monthPattern.test(start||'')||!monthPattern.test(end||'')||end<start)return [];const result=[];let [year,month]=start.split('-').map(Number),guard=0;while(guard++<240){const value=`${year}-${String(month).padStart(2,'0')}`;result.push(value);if(value===end)break;if(++month===13){month=1;year++}}return result.at(-1)===end?result:[]}
  function splitCents(total,count){const value=Math.max(0,Math.round(Number(total)||0));if(!count)return [];return Array.from({length:count},(_,index)=>Math.floor(value/count)+(index<value%count?1:0))}
  function dueDate(month,day){if(!day)return '';const [year,value]=month.split('-').map(Number),last=new Date(Date.UTC(year,value,0)).getUTCDate();return `${month}-${String(Math.min(Math.max(1,Number(day)||1),last)).padStart(2,'0')}`}
  function buildPlan({mode,startMonth,endMonth,dueDay,defaultMonthlyCents=0,people=[],monthlyAmounts={},targets={},splitBudget=false}){
    const months=monthsBetween(startMonth,endMonth),competencies=[],goals={};
    if(mode==='monthly'&&!months.length)return {ok:false,error:'Informe um período mensal válido.'};
    people.forEach(person=>{
      if(person.contributes===false){goals[person.id]=0;return}
      if(mode==='monthly'){
        const monthly=Number.isInteger(monthlyAmounts[person.id])?monthlyAmounts[person.id]:Math.max(0,Math.round(defaultMonthlyCents));goals[person.id]=monthly*months.length;
        months.forEach(month=>competencies.push({participantId:person.id,month,plannedCents:monthly,dueDate:dueDate(month,dueDay)}));
      }else{
        const goal=Math.max(0,Math.round(Number(targets[person.id])||0));goals[person.id]=goal;
        if(mode==='budget'&&splitBudget&&months.length)splitCents(goal,months.length).forEach((amount,index)=>competencies.push({participantId:person.id,month:months[index],plannedCents:amount,dueDate:dueDate(months[index],dueDay)}));
      }
    });
    return {ok:true,mode,months,goals,competencies,totalGoalCents:Object.values(goals).reduce((sum,value)=>sum+value,0),totalPlannedCents:competencies.reduce((sum,item)=>sum+item.plannedCents,0)};
  }
  root.JuntoPlanEngine={monthsBetween,splitCents,dueDate,buildPlan};
})(globalThis);
