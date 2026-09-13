import { pesquisar } from './pubmed.mjs';
import { filterUnpublished, bulletinItems } from './publication-history.mjs';
export async function collectWeekly(specialty,history,edition,search=pesquisar) {
  const groups=specialty.subramos||[],items=[],searches=[];
  for(const group of groups.length?groups:[{id:'urologia-geral',nome:'Pesquisa geral',pubmed:specialty.pubmed}]){
    if(!group.pubmed)continue;
    // A failed query is an error, never evidence that the subbranch has no studies.
    const found=await search(group.pubmed,30,group.id==='urologia-geral'?25:8);
    items.push(...found.map(a=>({...a,ramosCandidatos:[group.id]})));
    searches.push({subbranch:group.id,query:group.pubmed,found:found.length});
  }
  const result=filterUnpublished(items,history,edition);
  // Round-robin limits prompt volume without letting the first query fill every slot.
  const selected=[], queues=[...new Set(result.selected.flatMap(a=>a.ramosCandidatos))].map(id=>result.selected.filter(a=>a.ramosCandidatos.includes(id)));
  while(selected.length<40&&queues.some(q=>q.length))for(const queue of queues){const item=queue.shift();if(item&&!selected.includes(item)&&selected.length<40)selected.push(item);}
  return {...result,selected,searches,coverage:groups.map(g=>({id:g.id,name:g.nome,candidates:selected.filter(a=>a.ramosCandidatos.includes(g.id)).length}))};
}
export function coverageInstructions(specialty,report) {
  if(!specialty.subramos?.length)return '';
  return '\nDIVERSIDADE SEMANAL, SEM QUOTAS FIXAS:\n'+specialty.subramos.map(g=>'- '+g.id+' = '+g.nome+': '+report.coverage.find(c=>c.id===g.id).candidates+' candidatos inéditos recuperados.').join('\n')+
    '\nRecuperação por query é indicação temática, não classificação clínica. Busque uma seleção variada entre esses e outros subramos; não precisa ter todos na mesma semana. Qualidade e relevância precedem preencher categorias. Cada item tem um único data-subramo principal, usando um dos IDs acima ou outro. Não conte o mesmo artigo como andrologia e medicina sexual. Não use um desfecho sexual secundário de cirurgia de HPB para fingir cobertura de medicina sexual. Não crie cards vazios ou avisos por subramo ausente; a matriz de cobertura fica na evidência editorial.\n';
}
export function validateCoverage(html,specialty) {
  const errors=[],warnings=[],items=bulletinItems(html),groups=specialty.subramos||[];
  if(groups.length)for(const item of items)if(![...groups.map(g=>g.id),'outro'].includes(item.subbranch))errors.push('Classifique o subramo principal da fonte '+item.sourceId+'.');
  const coverage=groups.map(g=>({id:g.id,name:g.nome,items:items.filter(i=>i.subbranch===g.id).length}));
  if(groups.length&&coverage.filter(g=>g.items).length<3)warnings.push('Seleção concentrada: revisor deve avaliar variedade; não completar áreas com artigos fracos.');
  return {ok:!errors.length,errors,warnings,coverage};
}
