#!/usr/bin/env node
/**
 * Gera os rascunhos dos boletins da semana via API do Claude (roadmap 2.8).
 *
 * Uso:  ANTHROPIC_API_KEY=... node scripts/gerar-boletins.mjs [pasta-saida]
 *
 * Lê prompts/especialidades.json (só as com "ativa": true) e o template
 * prompts/boletim.md, gera um boletim-<slug>-AAAA-MM-DD.html por
 * especialidade e escreve na pasta de saída (padrão: raiz do repo).
 * NÃO toca no feed.json — publicação só acontece após revisão médica
 * (merge do PR de rascunho — ver .github/workflows/).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const API_URL = 'https://api.anthropic.com/v1/messages';
const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

const apiKey = process.env.ANTHROPIC_API_KEY;
if (!apiKey) {
  console.error('ANTHROPIC_API_KEY não definida.');
  process.exit(1);
}

const root = resolve(new URL('..', import.meta.url).pathname);
const saida = resolve(process.argv[2] ?? root);
const config = JSON.parse(readFileSync(join(root, 'prompts/especialidades.json'), 'utf8'));
const template = readFileSync(join(root, 'prompts/boletim.md'), 'utf8');
const modelo = process.env.ANTHROPIC_MODEL ?? config.edicaoPadrao.modelo;

/** Data da edição em America/Sao_Paulo (o cron roda em UTC). */
const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
const dataIso = agora.toISOString().slice(0, 10);
const dataExtenso = `${agora.getDate()} de ${MESES[agora.getMonth()]} de ${agora.getFullYear()}`;

async function gerarBoletim(esp) {
  const prompt = template
    .replaceAll('{{NOME}}', esp.nome)
    .replaceAll('{{SLUG}}', esp.slug)
    .replaceAll('{{COR}}', esp.cor ?? '#1d4ed8')
    .replaceAll('{{DATA_EXTENSO}}', dataExtenso)
    .replaceAll('{{DATA_ISO}}', dataIso)
    .replaceAll('{{FOCO}}', esp.foco)
    .replaceAll('{{QTD}}', String(config.edicaoPadrao.artigosPorBoletim));

  const res = await fetch(API_URL, {
    method: 'POST',
    headers: {
      'x-api-key': apiKey,
      'anthropic-version': '2023-06-01',
      'content-type': 'application/json',
    },
    body: JSON.stringify({
      model: modelo,
      max_tokens: 8192,
      tools: [{ type: 'web_search_20250305', name: 'web_search' }],
      messages: [{ role: 'user', content: prompt }],
    }),
  });
  if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);

  const data = await res.json();
  const html = (data.content ?? [])
    .filter((bloco) => bloco.type === 'text')
    .map((bloco) => bloco.text)
    .join('\n')
    .trim();

  // Extrai só o documento, mesmo se o modelo enrolar em cercas de código.
  const match = html.match(/<!doctype html[\s\S]*<\/html>/i);
  if (!match) throw new Error('resposta sem HTML completo');
  return match[0];
}

const ativas = config.especialidades.filter((e) => e.ativa);
console.log(`Edição de ${dataExtenso} — ${ativas.length} especialidade(s), modelo ${modelo}`);

let gerados = 0;
for (const esp of ativas) {
  const arquivo = `boletim-${esp.slug}-${dataIso}.html`;
  try {
    const html = await gerarBoletim(esp);
    writeFileSync(join(saida, arquivo), html + '\n');
    console.log(`✔ ${arquivo}`);
    gerados++;
  } catch (erro) {
    // Falha numa especialidade não derruba as outras — o revisor decide no PR.
    console.error(`✘ ${arquivo}: ${erro.message}`);
  }
}

console.log(`${gerados}/${ativas.length} boletim(ns) gerado(s).`);
if (gerados === 0) process.exit(1);
