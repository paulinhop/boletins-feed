import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync,writeFileSync,readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { articleKeys,filterUnpublished,priorPublication,publishedEntries,appendPublications,validateUnpublished,loadHistory } from './publication-history.mjs';
import { collectWeekly,validateCoverage,coverageInstructions } from './weekly-selection.mjs';
const previous='boletim-urologia-2026-09-06.html',current='boletim-urologia-2026-09-13.html';
const item={pmid:'123',doi:'10.1000/example',titulo:'A sufficiently long original scientific article title'};
const history={version:1,articles:[{edition:previous,date:'2026-09-06',keys:articleKeys(item),htmlSha256:'a'.repeat(64)}]};
test('prior article blocked across DOI URL aliases, PMID, renamed title, and same title without IDs',()=>{
  for(const candidate of [{doi:'https://dx.doi.org/10.1000/EXAMPLE.'},{pmid:'000123',titulo:'Renamed'}, {titulo:item.titulo.toUpperCase()}])assert.equal(priorPublication(candidate,history)?.edition,previous);
  assert.equal(priorPublication({pmid:'1234',doi:'10.1000/example-new'},history),undefined);
  assert.equal(priorPublication(item,history,previous),undefined);
});
test('draft validation checks primary material identity, regardless of output using only a different link alias',()=>{
  const html='<div class="item" data-source-id="1"><h3>Translated new title</h3><a href="https://pubmed.ncbi.nlm.nih.gov/123/">Source</a></div>';
  assert.equal(validateUnpublished(html,'[1] Study\nDOI: 10.1000/example\nPMID: 123',history,current).ok,false);
  assert.equal(validateUnpublished(html,'[1] New study\nDOI: 10.1000/new\nPMID: 124',history,current).ok,true);
});
test('publication ledger retains removed editions and merges DOI/PMID evidence for future weeks',()=>{
  const html='<div class="item" data-source-id="1"><h3>New translated title</h3></div>';
  const entries=publishedEntries(html,current,'[1] A new scientific publication with long title\nDOI: 10.1000/new\nPMID: 124');
  const merged=appendPublications(history,entries);
  assert.equal(merged.articles.length,2);
  assert.equal(appendPublications(merged,entries).articles.length,2);
  const dir=mkdtempSync(join(tmpdir(),'medbrain-history-')),file=join(dir,'history.json');
  writeFileSync(file,JSON.stringify(merged));
  assert.equal(priorPublication({pmid:'123'},loadHistory(file)).edition,previous);
  assert.equal(priorPublication({doi:'10.1000/new'},loadHistory(file)).edition,current);
  const original=readFileSync(file,'utf8');
  assert.equal(filterUnpublished([item],loadHistory(file),current).selected.length,0);
  assert.equal(readFileSync(file,'utf8'),original);
});
test('within-week dedup combines query branches without duplicating the study',()=>{
  const result=filterUnpublished([{...item,ramosCandidatos:['andrologia']},{...item,ramosCandidatos:['medicina-sexual']}],{version:1,articles:[]});
  assert.equal(result.selected.length,1);
  assert.deepEqual(result.selected[0].ramosCandidatos,['andrologia','medicina-sexual']);
});
const specialty={subramos:[{id:'andrologia',nome:'Andrologia',pubmed:'query-a'},{id:'hpb',nome:'HPB',pubmed:'query-h'}]};
test('separate branch searches exclude history before handing material to AI',async()=>{
  const calls=[];
  const result=await collectWeekly(specialty,history,current,async(query,days)=>{calls.push([query,days]);return query==='query-a'?[item,{pmid:'9',titulo:'A new andrology study'}]:[{pmid:'8',titulo:'A new HPB study'}];});
  assert.deepEqual(calls,[['query-a',30],['query-h',30]]);
  assert.equal(result.selected.length,2);
  assert.equal(result.excluded.length,1);
  assert.deepEqual(result.coverage.map(c=>c.candidates),[1,1]);
  assert.match(coverageInstructions(specialty,result),/não precisa ter todos/);
});
test('failed subbranch query is never recorded as absence of studies',async()=>{
  await assert.rejects(collectWeekly(specialty,history,current,async()=>{throw Error('PubMed unavailable');}),/unavailable/);
});
test('diversity is guidance without mandatory quotas; primary subbranch is still auditable',()=>{
  const html='<div class="item" data-source-id="1" data-subramo="hpb"><h3>Study</h3></div>';
  const result=validateCoverage(html,specialty);
  assert.equal(result.ok,true);
  assert.equal(result.coverage[0].items,0);
  assert.equal(result.warnings.length,1);
  assert.equal(validateCoverage(html.replace('data-subramo="hpb"','data-subramo="hpb andrologia"'),specialty).ok,false);
});
test('corrupt or incomplete historical evidence blocks validation',()=>{
  const dir=mkdtempSync(join(tmpdir(),'medbrain-history-')),file=join(dir,'history.json');
  writeFileSync(file,JSON.stringify({...history,importAudit:{unparsed:[{}]}}));
  assert.throws(()=>loadHistory(file),/não auditadas/);
  writeFileSync(file,'{ broken');assert.throws(()=>loadHistory(file));
});
