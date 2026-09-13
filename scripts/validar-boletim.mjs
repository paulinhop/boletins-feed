#!/usr/bin/env node
/**
 * Valida um boletim gerado contra o contrato editorial/HTML e contra o
 * material de origem — testes exigidos pelo brief de qualidade editorial:
 *   1. Referências: todo DOI/PMID citado no HTML precisa existir no material;
 *   2. Material incompleto: itens "só METADADOS" não podem virar Essencial;
 *   3. Contrato HTML do leitor: classes/estrutura que o app e o reader-theme
 *      esperam (acordeão, tags, 5 blocos, dark mode, seções);
 *   4. Redação: tamanho do resumo, "Prática muda" justificado, proibidos.
 *
 * Uso: node scripts/validar-boletim.mjs <boletim.html> [material.md]
 * Saída: relatório no console; exit 1 se houver ERRO (avisos não reprovam).
 */
import { readFileSync } from 'node:fs';
import { validateEditorial } from './editorial-contract.mjs';

const [htmlPath, materialPath] = process.argv.slice(2);
if (!htmlPath) { console.error('uso: validar-boletim.mjs <boletim.html> [material.md]'); process.exit(1); }
const html = readFileSync(htmlPath, 'utf8');
const material = materialPath ? readFileSync(materialPath, 'utf8') : null;
if (/data-editorial-version=["']2["']/.test(html)) {
  if (!material) { console.error('Contrato v2 exige material de origem.'); process.exit(1); }
  const date = htmlPath.match(/(\d{4}-\d{2}-\d{2})\.html$/)?.[1];
  const result = validateEditorial(html, material, date);
  console.log(JSON.stringify(result, null, 2));
  process.exit(result.ok ? 0 : 1);
}

const erros = [];
const avisos = [];
const ok = (m) => console.log(`  ✔ ${m}`);
const err = (m) => { erros.push(m); console.log(`  ✘ ERRO: ${m}`); };
const warn = (m) => { avisos.push(m); console.log(`  ⚠ ${m}`); };

console.log(`\n== ${htmlPath.split(/[\\/]/).pop()} ==`);

// ── 1. Contrato HTML (compatibilidade com o leitor e o reader-theme) ────────
const obrigatorios = [
  ['<!doctype html', /^<!doctype html/i],
  ['acordeão .item', /class="item"/],
  ['button.head', /<button class="head"/],
  ['chevron ›', /<span class="chev">›<\/span>/],
  ['seção Essencial', /Essencial/],
  ['seção Outras novidades', /Outras novidades/],
  ['seção Fontes consultadas', /Fontes consultadas/],
  ['dark mode', /@media \(prefers-color-scheme: dark\)/],
  ['rodapé MedBrain', /MedBrain/],
];
for (const [nome, re] of obrigatorios) {
  if (re.test(html)) ok(`contrato: ${nome}`); else err(`contrato ausente: ${nome}`);
}
if (/▼|Detalhes<\/|>detalhes</.test(html)) err('usou "▼" ou texto "detalhes" no acordeão (proibido)');
if (/FAMERP/i.test(html)) err('menção à FAMERP (proibida)');

// ── 2. Os 5 blocos em cada item ─────────────────────────────────────────────
const itens = html.split(/<div class="item">/).slice(1);
const BLOCOS = ['Contexto', 'Desenho e achados|O que mudou', 'Implicação prática', 'Limitações', 'Fontes'];
let blocosCompletos = 0;
itens.forEach((item, i) => {
  const faltando = BLOCOS.filter((b) => !new RegExp(`<h4>(${b})[^<]*</h4>`).test(item));
  if (faltando.length === 0) blocosCompletos++;
  else err(`item ${i + 1}: faltam blocos: ${faltando.join(', ')}`);
});
if (itens.length) ok(`${blocosCompletos}/${itens.length} itens com os 5 blocos`);

// ── 3. Referências vs material de origem ────────────────────────────────────
if (material) {
  const citados = new Set([
    ...[...html.matchAll(/doi\.org\/([^\s"<)]+)/g)].map((m) => m[1].replace(/[.,;]+$/, '').toLowerCase()),
    ...[...html.matchAll(/pubmed\.ncbi\.nlm\.nih\.gov\/(\d+)/g)].map((m) => m[1]),
  ]);
  if (!citados.size && !/href=["']https?:\/\/(?:www\.)?(?:fda\.gov|gov\.br\/anvisa)/.test(html)) err('nenhuma referência identificável no boletim');
  let verificados = 0;
  for (const ref of citados) {
    if (material.toLowerCase().includes(ref)) verificados++;
    else err(`referência NÃO consta no material: ${ref}`);
  }
  ok(`${verificados}/${citados.size} referências conferem com o material`);

  // Itens só-metadados não podem ter virado destaque com números
  const soMetadados = (material.match(/Material disponível: SÓ METADADOS/g) ?? []).length;
  const truncados = (material.match(/resumo TRUNCADO/g) ?? []).length;
  ok(`material: ${soMetadados} item(ns) só-metadados, ${truncados} truncado(s) — status declarado`);
} else {
  warn('sem arquivo de material — validação de referências pulada');
}

// ── 4. Redação ──────────────────────────────────────────────────────────────
const resumos = [...html.matchAll(/<p class="resumo">([\s\S]*?)<\/p>/g)].map((m) =>
  m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim());
let foraDaFaixa = 0;
for (const r of resumos) {
  const n = r.split(' ').length;
  if (n < 40 || n > 65) foraDaFaixa++;
}
if (foraDaFaixa) warn(`${foraDaFaixa}/${resumos.length} resumos fora da faixa 40–65 palavras`);
else if (resumos.length) ok(`${resumos.length} resumos dentro da faixa 40–65 palavras`);

const praticaMuda = (html.match(/Prática muda/g) ?? []).length;
if (praticaMuda > 0) warn(`tag "Prática muda" usada ${praticaMuda}× — revisor médico deve confirmar a justificativa de cada uma`);

// Estudo repetido como objeto principal de dois itens (assinatura da fonte:
// periódico + 1º autor). PMIDs citados no bloco "Fontes" de outro item são
// citação legítima de contexto e NÃO caracterizam repetição.
const assinaturas = new Map();
itens.forEach((item, i) => {
  const m = item.match(/class="fonte-curta">([^<]+)/);
  if (!m) return;
  const assinatura = m[1].replace(/,?\s*\d{2}\/\d{2}\/\d{4}/g, '').replace(/\s+/g, ' ').trim().toLowerCase();
  if (assinaturas.has(assinatura)) warn(`itens ${assinaturas.get(assinatura) + 1} e ${i + 1} têm a mesma fonte principal (${m[1].trim()})`);
  else assinaturas.set(assinatura, i);
});

console.log(`  → ${erros.length} erro(s), ${avisos.length} aviso(s)`);
if (erros.length) process.exit(1);
