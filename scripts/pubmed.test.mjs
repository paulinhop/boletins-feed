import test from 'node:test';
import assert from 'node:assert/strict';
import { publicationDates, recentPublication } from './pubmed.mjs';
test('publication date ignores indexing dates and preserves earlier online publication',()=>{
 const xml='<DateCompleted><Year>2026</Year><Month>08</Month><Day>20</Day></DateCompleted><JournalIssue><PubDate><Year>2026</Year><Month>Sep</Month><Day>01</Day></PubDate></JournalIssue><ArticleDate DateType="Electronic"><Year>2026</Year><Month>07</Month><Day>09</Day></ArticleDate>';
 assert.deepEqual(publicationDates(xml),{data:'2026 07 09',dataOnline:'2026 07 09',dataEdicao:'2026 09 01',dataIndexacaoInicial:''});
 assert.equal(recentPublication(publicationDates(xml),'2026-08-14','2026-09-13'),false);
});
test('partial journal publication date never borrows a day from another date node',()=>{
 const dates=publicationDates('<JournalIssue><PubDate><Year>2026</Year><Month>Sep</Month></PubDate></JournalIssue><DateRevised><Year>2026</Year><Month>09</Month><Day>12</Day></DateRevised>');
 assert.equal(dates.data,'2026 09');assert.equal(recentPublication(dates,'2026-08-14','2026-09-13'),true);
 assert.equal(recentPublication({data:'2026 08'},'2026-08-14','2026-09-13'),false);
});

test('old indexed paper cannot reappear as novelty merely because print issue is recent',()=>{
 const dates=publicationDates('<JournalIssue><PubDate><Year>2026</Year><Month>Sep</Month></PubDate></JournalIssue><PubMedPubDate PubStatus="pubmed"><Year>2026</Year><Month>02</Month><Day>13</Day></PubMedPubDate>');
 assert.equal(dates.data,'2026 09');
 assert.equal(dates.dataIndexacaoInicial,'2026 02 13');
 assert.equal(recentPublication(dates,'2026-08-14','2026-09-13'),false);
});
