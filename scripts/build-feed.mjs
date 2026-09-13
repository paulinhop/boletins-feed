#!/usr/bin/env node
/**
 * Gera o feed.json a partir dos boletins .html de uma pasta (Fase 2 — ver docs/feed.md).
 *
 * Uso:  node scripts/build-feed.mjs <pasta-dos-boletins>
 *
 * O manifesto é escrito na própria pasta; depois basta subir os arquivos
 * (.html + feed.json) no repositório público do feed.
 */
import { readdirSync, readFileSync, writeFileSync, renameSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { digest, validateEditorial } from './editorial-contract.mjs';
import { loadHistory,validateUnpublished,publishedEntries,appendPublications } from './publication-history.mjs';
import { validateCoverage } from './weekly-selection.mjs';

const dir = resolve(process.argv[2] ?? '.');
const historyPath=join(dir,'prompts/published-articles.json');
let history=loadHistory(historyPath);
const specialties=JSON.parse(readFileSync(new URL('../prompts/especialidades.json',import.meta.url),'utf8')).especialidades;
// Previously published immutable versions remain readable under their original contract.
const knownPublished=new Set(history.articles.map(a=>a.edition+':'+a.htmlSha256));
const legacy = JSON.parse(
  readFileSync(
    new URL('../prompts/legacy-editions.json', import.meta.url),
    'utf8',
  ),
);
const files = readdirSync(dir)
  .filter((f) => /^boletim-[a-z0-9-]+-\d{4}-\d{2}-\d{2}\.html$/i.test(f))
  .sort();

// Old editions remain readable. New v2 editions must retain their evidence packet.
for (const file of files) {
  const html = readFileSync(join(dir, file), 'utf8');
  if (!/data-editorial-version=["']2["']/.test(html)) {
    if (legacy[file] !== digest(html))
      throw new Error(
        `${file}: edição nova/alterada exige o contrato v2 e material de origem.`,
      );
    continue;
  }
  const [, slug, date] = file.match(/^boletim-(.+)-(\d{4}-\d{2}-\d{2})\.html$/);
  const material = readFileSync(
    join(dir, 'evidencias', `material-${slug}-${date}.md`),
    'utf8',
  );
  const result = validateEditorial(html, material, date);
  if(!knownPublished.has(file+':'+digest(html))){
    const novelty=validateUnpublished(html,material,history,file);
    const coverage=validateCoverage(html,specialties.find(e=>e.slug===slug)||{});
    result.errors.push(...novelty.errors,...coverage.errors);
    result.ok=!result.errors.length;
  }
  if (!result.ok) throw new Error(`${file}: ${result.errors.join(' | ')}`);
  history=appendPublications(history,publishedEntries(html,file,material));
}
const manifest = { version: 1, updatedAt: new Date().toISOString(), files };
// Ledger first: interruption may reserve an article, but never publishes it unrecorded.
writeFileSync(historyPath+'.pending',JSON.stringify(history,null,2)+'\n');
renameSync(historyPath+'.pending',historyPath);
writeFileSync(join(dir, 'feed.json.pending'), JSON.stringify(manifest, null, 2) + '\n');
renameSync(join(dir,'feed.json.pending'),join(dir,'feed.json'));
console.log(`feed.json gerado com ${files.length} boletim(ns) em ${dir}`);
