import { readFileSync } from 'node:fs';
import { digest, materialSources } from './editorial-contract.mjs';

const plain = text => text.replace(/<[^>]*>/g,' ').replace(/&#(?:x([0-9a-f]+)|(\d+));/gi,(_,hex,num)=>String.fromCodePoint(parseInt(hex||num,hex?16:10))).replace(/&amp;/gi,'&').replace(/&(?:nbsp|quot|apos);/gi,' ').replace(/\s+/g,' ').trim();
const attribute = (text,name) => text.match(new RegExp('\\b'+name+'=["\x27]([^"\x27]*)["\x27]','i'))?.[1] || '';
export function articleKeys(article) {
  const keys=[];
  let doi=String(article.doi||'').trim().replace(/^https?:\/\/(?:dx\.)?doi\.org\//i,'').replace(/^doi:\s*/i,'');
  try { doi=decodeURIComponent(doi); } catch { /* Keep literal if percent encoding is malformed. */ }
  doi=doi.toLowerCase().replace(/[.,;]+$/,'');
  if(/^10\.\d{4,9}\/\S+$/.test(doi))keys.push('doi:'+doi);
  const pmid=String(article.pmid||'').trim().replace(/^https?:\/\/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)\/?(?:\?.*)?$/i,'$1');
  if(/^\d+$/.test(pmid))keys.push('pmid:'+pmid.replace(/^0+(?=\d)/,''));
  const title=plain(article.titulo||article.title||'').normalize('NFD').replace(/[\u0300-\u036f]/g,'').toLowerCase().replace(/[^\p{L}\p{N}]+/gu,' ').trim();
  if(title.length>=30)keys.push('title:'+title);
  return keys;
}
export function identityFromText(text) {
  return {
    doi:text.match(/(?:https?:\/\/(?:dx\.)?doi\.org\/|\bDOI:\s*)(10\.\d{4,9}\/[^\s<>"']+)/i)?.[1]||'',
    pmid:text.match(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/i)?.[1]||text.match(/\bPMID:\s*(\d+)/i)?.[1]||'',
    titulo:plain(text.split('\n')[0].replace(/^\[[R]?\d+\]\s*/,'')),
  };
}
export function bulletinItems(html) {
  const starts=[...html.matchAll(/<div\b[^>]*class=["']item["'][^>]*>/g)];
  return starts.map((m,i)=>{
    let end=starts[i+1]?.index??html.length;
    const final=html.indexOf('<div class="fontes-finais"',m.index);
    if(final>=0)end=Math.min(end,final);
    const chunk=html.slice(m.index,end);
    const reference=chunk.match(/<div\b[^>]*class=["']refs["'][^>]*>[\s\S]*?<p\b[^>]*>([\s\S]*?)<\/p>/i)?.[1]||chunk;
    return {chunk,sourceId:attribute(m[0],'data-source-id'),subbranch:attribute(m[0],'data-subramo'),
      ...identityFromText(reference),titulo:plain(chunk.match(/<h3\b[^>]*>([\s\S]*?)<\/h3>/i)?.[1]||'')};
  });
}
export function publishedEntries(html,edition,material='') {
  const sources=materialSources(material);
  let items=bulletinItems(html);
  if(!items.length)items=[...html.matchAll(/<article\b[^>]*>([\s\S]*?)<\/article>/gi)].map(m=>({...identityFromText(m[1]),titulo:plain(m[1].match(/<h[23]\b[^>]*>([\s\S]*?)<\/h[23]>/i)?.[1]||'')}));
  return items.map(item=>{
    const source=sources.find(s=>s.id===item.sourceId);
    const identity=source?identityFromText(source.text):item;
    const keys=articleKeys(identity);
    if(!keys.length)throw Error(edition+': artigo sem identidade rastreável.');
    return {edition,date:edition.match(/(\d{4}-\d{2}-\d{2})\.html$/)?.[1],htmlSha256:digest(html),keys};
  });
}
export function loadHistory(path) {
  const history=JSON.parse(readFileSync(path,'utf8'));
  if(history.importAudit?.unparsed?.length)throw Error('Histórico com edições não auditadas: pesquisa/publicação bloqueada.');
  if(history.version!==1||!Array.isArray(history.articles)||history.articles.some(a=>!/^boletim-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.html$/.test(a.edition)||!/^\d{4}-\d{2}-\d{2}$/.test(a.date)||!Array.isArray(a.keys)||!a.keys.length||a.keys.some(k=>typeof k!=='string'||!/^(doi|pmid|title):.+/.test(k))))throw Error('Histórico publicado inválido: pesquisa/publicação bloqueada.');
  return history;
}
export function priorPublication(article,history,excludeEdition='') {
  const keys=new Set(articleKeys(article));
  return history.articles.find(a=>a.edition!==excludeEdition&&a.keys.some(k=>keys.has(k)));
}
export function filterUnpublished(items,history,excludeEdition='') {
  const selected=[],excluded=[];
  for(const item of items){
    const prior=priorPublication(item,history,excludeEdition);
    if(prior){excluded.push({pmid:item.pmid,doi:item.doi,edition:prior.edition});continue;}
    const keys=articleKeys(item);
    const duplicate=selected.find(a=>articleKeys(a).some(k=>keys.includes(k)));
    if(duplicate){duplicate.ramosCandidatos=[...new Set([...(duplicate.ramosCandidatos||[]),...(item.ramosCandidatos||[])])];continue;}
    selected.push({...item});
  }
  return {selected,excluded};
}
export function validateUnpublished(html,material,history,edition) {
  const sources=materialSources(material),errors=[];
  for(const item of bulletinItems(html)){
    const source=sources.find(s=>s.id===item.sourceId);
    if(!source){errors.push('Histórico: fonte principal ausente para verificar repetição.');continue;}
    const prior=priorPublication(identityFromText(source.text),history,edition);
    if(prior)errors.push('Artigo já publicado em '+prior.edition+' (fonte '+item.sourceId+').');
  }
  return {ok:!errors.length,errors};
}
export function appendPublications(history,entries) {
  const existing=new Set(history.articles.map(a=>JSON.stringify(a)));
  return {...history,articles:[...history.articles,...entries.filter(a=>{const key=JSON.stringify(a);if(existing.has(key))return false;existing.add(key);return true;})]};
}
