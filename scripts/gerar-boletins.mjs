#!/usr/bin/env node
/**
 * Gera os rascunhos dos boletins da semana via API de IA (roadmap 2.8).
 *
 * Uso:  PROVIDER=claude ANTHROPIC_API_KEY=... node scripts/gerar-boletins.mjs [pasta-saida]
 *
 * Pipeline em 2 estágios (custo inteligente):
 *   1. PESQUISA grátis e determinística via PubMed E-utilities (scripts/pubmed.mjs)
 *      — artigos reais dos últimos 30 dias, com DOI/resumo, sem gastar token.
 *   2. COMPOSIÇÃO pela IA: o modelo recebe o material verificado e só seleciona
 *      (regras de tier/citações do template) e redige o HTML. Sem web_search —
 *      era o loop de busca que consumia o orçamento (cada rodada reenvia o
 *      contexto todo como input).
 *
 * Provedores suportados (env PROVIDER, padrão "claude"):
 *   claude  — Anthropic Messages API  (secret ANTHROPIC_API_KEY, env ANTHROPIC_MODEL)
 *   openai  — OpenAI Responses API    (secret OPENAI_API_KEY,    env OPENAI_MODEL)
 *   kimi    — Moonshot chat completions (secret MOONSHOT_API_KEY, env MOONSHOT_MODEL)
 *
 * Para o comparativo A/B/C, o workflow roda uma vez por provedor e abre um PR
 * por branch (rascunho/DATA-provedor). Decisão de padrão: revisão médica cega
 * (ver docs/roadmap.md no repo principal, item 2.8).
 *
 * Lê prompts/especialidades.json (só as com "ativa": true) e o template
 * prompts/boletim.md, gera um boletim-<slug>-AAAA-MM-DD.html por especialidade
 * e escreve na pasta de saída (padrão: raiz do repo). NÃO toca no feed.json —
 * publicação só após revisão médica (merge do PR — ver .github/workflows/).
 */
import { readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

import { pesquisar, formatarParaPrompt, enriquecerCitacoes } from './pubmed.mjs';
import { regulatorio, formatarRegulatorio } from './fontes-extra.mjs';

const MESES = [
  'janeiro', 'fevereiro', 'março', 'abril', 'maio', 'junho',
  'julho', 'agosto', 'setembro', 'outubro', 'novembro', 'dezembro',
];

/** Cada provedor: env da chave, modelo padrão e a chamada que devolve texto puro. */
const PROVEDORES = {
  claude: {
    envKey: 'ANTHROPIC_API_KEY',
    modeloPadrao: 'claude-sonnet-4-5',
    async chamar(prompt, modelo, apiKey) {
      const res = await fetch('https://api.anthropic.com/v1/messages', {
        method: 'POST',
        headers: {
          'x-api-key': apiKey,
          'anthropic-version': '2023-06-01',
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: modelo,
          // O template rico (seções + detalhamento + refs) gera HTML longo;
          // com a busca web no loop, 8192 cortava a resposta no meio
          // ("resposta sem HTML completo"). 64k = teto de saída do Sonnet 4.5.
          max_tokens: 64000,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      return (data.content ?? [])
        .filter((b) => b.type === 'text')
        .map((b) => b.text)
        .join('\n');
    },
  },
  openai: {
    envKey: 'OPENAI_API_KEY',
    modeloPadrao: 'gpt-5-mini',  // ~20x mais barato que gpt-5; GPT-5/Fable ficam p/ o comparativo mensal
    async chamar(prompt, modelo, apiKey) {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: modelo,
          input: prompt,
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      if (data.output_text) return data.output_text;
      return (data.output ?? [])
        .flatMap((item) => item.content ?? [])
        .filter((c) => c.type === 'output_text')
        .map((c) => c.text)
        .join('\n');
    },
  },
  kimi: {
    envKey: 'MOONSHOT_API_KEY',
    modeloPadrao: 'kimi-latest',
    async chamar(prompt, modelo, apiKey) {
      const res = await fetch('https://api.moonshot.ai/v1/chat/completions', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: modelo,
          messages: [{ role: 'user', content: prompt }],
        }),
      });
      if (!res.ok) throw new Error(`API ${res.status}: ${(await res.text()).slice(0, 300)}`);
      const data = await res.json();
      return data.choices?.[0]?.message?.content ?? '';
    },
  },
};

const provider = (process.env.PROVIDER ?? 'claude').toLowerCase();
const cfg = PROVEDORES[provider];
if (!cfg) {
  console.error(`PROVIDER "${provider}" desconhecido. Use: ${Object.keys(PROVEDORES).join(', ')}.`);
  process.exit(1);
}
const apiKey = process.env[cfg.envKey];
if (!apiKey) {
  console.error(`${cfg.envKey} não definida (provider ${provider}).`);
  process.exit(1);
}

const root = resolve(new URL('..', import.meta.url).pathname);
const saida = resolve(process.argv[2] ?? root);
const config = JSON.parse(readFileSync(join(root, 'prompts/especialidades.json'), 'utf8'));
const template = readFileSync(join(root, 'prompts/boletim.md'), 'utf8');
const modelo =
  process.env[`${provider.toUpperCase()}_MODEL`] ??
  (provider === 'claude' ? config.edicaoPadrao.modelo : cfg.modeloPadrao);

/** Data da edição em America/Sao_Paulo (o cron roda em UTC). */
const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
const dataIso = agora.toISOString().slice(0, 10);
const dataExtenso = `${agora.getDate()} de ${MESES[agora.getMonth()]} de ${agora.getFullYear()}`;

async function montarPrompt(esp) {
  // Estágio 1 (grátis): material verificado do PubMed (com contagem real de
  // citações via OpenAlex) + notícias regulatórias de FDA/ANVISA — a IA só redige.
  let material = '(Especialidade sem query PubMed configurada — gere menos itens.)';
  if (esp.pubmed) {
    try {
      const itens = await enriquecerCitacoes(await pesquisar(esp.pubmed, 30, 25));
      material = formatarParaPrompt(itens);
      console.log(`  PubMed: ${itens.length} artigo(s) encontrados para ${esp.slug}`);
    } catch (erro) {
      console.warn(`  PubMed falhou para ${esp.slug}: ${erro.message} — seguindo sem material`);
    }
  }
  const noticias = await regulatorio(esp.regulatorioKeywords ?? [], 30);
  if (noticias.length) console.log(`  Regulatório: ${noticias.length} notícia(s) para ${esp.slug}`);
  material += `\n\nNOTÍCIAS REGULATÓRIAS (FDA/ANVISA — verificadas, podem virar itens com tag t-reg "Regulatório"):\n${formatarRegulatorio(noticias)}`;
  return template
    .replaceAll('{{NOME}}', esp.nome)
    .replaceAll('{{SLUG}}', esp.slug)
    .replaceAll('{{COR}}', esp.cor ?? '#1d4ed8')
    .replaceAll('{{DATA_EXTENSO}}', dataExtenso)
    .replaceAll('{{DATA_ISO}}', dataIso)
    .replaceAll('{{FOCO}}', esp.foco)
    .replaceAll('{{QTD}}', String(config.edicaoPadrao.artigosPorBoletim))
    .replaceAll('{{MATERIAL}}', material);
}

/** Extrai só o documento, mesmo se o modelo enrolar em cercas de código. */
function extrairHtml(texto) {
  const match = texto.trim().match(/<!doctype html[\s\S]*<\/html>/i);
  if (!match) throw new Error('resposta sem HTML completo');
  return match[0];
}

const ativas = config.especialidades.filter((e) => e.ativa);
console.log(`Edição de ${dataExtenso} — provider ${provider}, modelo ${modelo}, ${ativas.length} especialidade(s)`);

let gerados = 0;
for (const esp of ativas) {
  const arquivo = `boletim-${esp.slug}-${dataIso}.html`;
  let feito = false;
  // Até 2 tentativas: com busca web no loop, a resposta pode vir truncada
  // (max_tokens) ou pausada — uma segunda chamada costuma completar.
  for (let tentativa = 1; tentativa <= 2 && !feito; tentativa++) {
    try {
      const texto = await cfg.chamar(await montarPrompt(esp), modelo, apiKey);
      writeFileSync(join(saida, arquivo), extrairHtml(texto) + '\n');
      console.log(`✔ ${arquivo}${tentativa > 1 ? ` (tentativa ${tentativa})` : ''}`);
      gerados++;
      feito = true;
    } catch (erro) {
      if (tentativa === 2) {
        // Falha numa especialidade não derruba as outras — o revisor decide no PR.
        console.error(`✘ ${arquivo}: ${erro.message}`);
      } else {
        console.warn(`… ${arquivo}: ${erro.message} — tentando de novo`);
      }
    }
  }
}

console.log(`${gerados}/${ativas.length} boletim(ns) gerado(s).`);
if (gerados === 0) process.exit(1);
