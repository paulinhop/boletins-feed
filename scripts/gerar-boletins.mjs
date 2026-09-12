#!/usr/bin/env node
/**
 * Gera os rascunhos dos boletins da semana via API de IA (roadmap 2.8).
 *
 * Uso:  PROVIDER=claude ANTHROPIC_API_KEY=... node scripts/gerar-boletins.mjs [pasta-saida]
 *
 * Provedores suportados (env PROVIDER, padrão "claude"):
 *   claude  — Anthropic Messages API + web_search   (secret ANTHROPIC_API_KEY, env ANTHROPIC_MODEL)
 *   openai  — OpenAI Responses API + web_search     (secret OPENAI_API_KEY,    env OPENAI_MODEL)
 *   kimi    — Moonshot chat completions + $web_search (secret MOONSHOT_API_KEY, env MOONSHOT_MODEL)
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
          // 8192 cortava a resposta no meio ("resposta sem HTML completo").
          max_tokens: 32768,
          tools: [{ type: 'web_search_20250305', name: 'web_search' }],
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
    modeloPadrao: 'gpt-5',
    async chamar(prompt, modelo, apiKey) {
      const res = await fetch('https://api.openai.com/v1/responses', {
        method: 'POST',
        headers: {
          authorization: `Bearer ${apiKey}`,
          'content-type': 'application/json',
        },
        body: JSON.stringify({
          model: modelo,
          tools: [{ type: 'web_search' }],
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
          tools: [{ type: 'builtin_function', function: { name: '$web_search' } }],
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

function montarPrompt(esp) {
  return template
    .replaceAll('{{NOME}}', esp.nome)
    .replaceAll('{{SLUG}}', esp.slug)
    .replaceAll('{{COR}}', esp.cor ?? '#1d4ed8')
    .replaceAll('{{DATA_EXTENSO}}', dataExtenso)
    .replaceAll('{{DATA_ISO}}', dataIso)
    .replaceAll('{{FOCO}}', esp.foco)
    .replaceAll('{{QTD}}', String(config.edicaoPadrao.artigosPorBoletim));
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
  try {
    const texto = await cfg.chamar(montarPrompt(esp), modelo, apiKey);
    writeFileSync(join(saida, arquivo), extrairHtml(texto) + '\n');
    console.log(`✔ ${arquivo}`);
    gerados++;
  } catch (erro) {
    // Falha numa especialidade não derruba as outras — o revisor decide no PR.
    console.error(`✘ ${arquivo}: ${erro.message}`);
  }
}

console.log(`${gerados}/${ativas.length} boletim(ns) gerado(s).`);
if (gerados === 0) process.exit(1);
