// Import only HTML versions referenced by feed.json on main. Draft branches are excluded.
import { execFileSync } from 'node:child_process';
import { writeFileSync, existsSync, readFileSync } from 'node:fs';
import { publishedEntries, appendPublications } from './publication-history.mjs';
const git=(...args)=>execFileSync('git',args,{encoding:'utf8',maxBuffer:32*1024*1024});
if(git('rev-parse','--is-shallow-repository').trim()==='true')throw Error('Use histórico Git completo antes de importar publicações antigas.');
const commits=git('rev-list','--reverse','main','--','feed.json').trim().split('\n').filter(Boolean);
let history={version:1,provenance:'Snapshots de feed.json em main; não inclui rascunhos nem prova revisão clínica.',articles:[]};
const seen=new Set(),unparsed=[],demonstrations=[];
for(const commit of commits){
  const manifest=JSON.parse(git('show',commit+':feed.json'));
  for(const file of manifest.files||[]){
    if(!/^boletim-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.html$/.test(file))throw Error('Arquivo inválido no manifesto histórico.');
    const blob=git('rev-parse',commit+':'+file).trim();
    if(seen.has(file+':'+blob))continue;seen.add(file+':'+blob);
    const html=git('show',commit+':'+file);
    if(/Conteúdo fictício/i.test(html)&&/Edição de teste do feed/i.test(html)){demonstrations.push({edition:file,commit,reason:'Demonstração explicitamente fictícia, sem estudos clínicos.'});continue;}
    const entries=publishedEntries(html,file);
    if(!entries.length)unparsed.push({edition:file,commit,reason:'Sem estrutura de artigo; exige auditoria antes de tratar como histórico completo.'});
    history=appendPublications(history,entries);
  }
}
if(existsSync('prompts/published-articles.json'))history=appendPublications(history,JSON.parse(readFileSync('prompts/published-articles.json','utf8')).articles);
history.importAudit={commits:commits.length,htmlVersions:seen.size,unparsed,demonstrations};
writeFileSync('prompts/published-articles.json',JSON.stringify(history,null,2)+'\n');
console.log(JSON.stringify({articles:history.articles.length,...history.importAudit}));
