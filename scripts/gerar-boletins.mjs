#!/usr/bin/env node
/**
 * Gera rascunhos exclusivamente pelo gateway local (política de 13/09/2026).
 *
 * Uso:  PROVIDER=gateway node scripts/gerar-boletins.mjs [pasta-saida]
 *
 * Pipeline em 2 estágios (custo inteligente):
 *   1. PESQUISA grátis e determinística via PubMed E-utilities (scripts/pubmed.mjs)
 *      — artigos reais dos últimos 30 dias, com DOI/resumo, sem gastar token.
 *   2. COMPOSIÇÃO pela IA: o modelo recebe o material verificado e só seleciona
 *      (regras de tier/citações do template) e redige o HTML. Sem web_search —
 *      era o loop de busca que consumia o orçamento (cada rodada reenvia o
 *      contexto todo como input).
 *
 * Adaptadores históricos preservados mas bloqueados (somente gateway autorizado):
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
import { readFileSync, writeFileSync, mkdirSync, renameSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { formatarParaPrompt, enriquecerCitacoes } from './pubmed.mjs';
import { regulatorio, formatarRegulatorio } from './fontes-extra.mjs';
import { editionDate, validateEditorial } from './editorial-contract.mjs';
import { loadHistory, validateUnpublished } from './publication-history.mjs';
import { collectWeekly, coverageInstructions, validateCoverage } from './weekly-selection.mjs';

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
      registrarUso(modelo, data.usage);
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
      registrarUso(modelo, data.usage);
      return openaiExtrairTexto(data);
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

  // ── IA Gateway (assinaturas via OAuth no servidor 192.168.1.111) ──────────
  // Mesma ideia dos modos CLI, mas por HTTP: POST /ask + polling em /job/<id>.
  // Sem API key de IA em lugar nenhum — só o token do gateway (secret
  // IA_GATEWAY_TOKEN; URL em IA_GATEWAY_URL, padrão: endpoint público HTTPS).
  // O gateway não limita mais o tamanho do prompt (limite de 16k removido em
  // 12/09/2026); o teto real é a janela de contexto do modelo.
  gateway: {
    envKey: 'IA_GATEWAY_TOKEN',
    modeloPadrao: 'fable', // topo de linha da assinatura Claude; IA_GATEWAY_MODEL sobrescreve
    async chamar(prompt, modelo, apiKey) {
      const base = (process.env.IA_GATEWAY_URL ?? (() => { throw new Error('IA_GATEWAY_URL não definida — endpoint do gateway não fica no repo'); })()).replace(/\/$/, '');
      const gwProvider = process.env.IA_GATEWAY_PROVIDER ?? 'claude';
      const headers = { 'X-Token': apiKey, 'content-type': 'application/json' };
      const askRes = await fetch(`${base}/ask`, {
        method: 'POST',
        headers,
        body: JSON.stringify({ provider: gwProvider, prompt, mode: 'ask', ...(modelo ? { model: modelo } : {}) }),
      });
      if (!askRes.ok) throw new Error(`gateway /ask ${askRes.status}: ${(await askRes.text()).slice(0, 300)}`);
      const { id } = await askRes.json();
      // Polling: o gateway enfileira (1 worker). Boletim leva minutos — 2s de
      // intervalo, teto de 20 min igual ao timeout dos CLIs.
      const teto = Date.now() + 20 * 60 * 1000;
      for (;;) {
        if (Date.now() > teto) throw new Error('gateway: job não concluiu em 20 min');
        await new Promise((r) => setTimeout(r, 2000));
        const jobRes = await fetch(`${base}/job/${id}`, { headers });
        if (!jobRes.ok) throw new Error(`gateway /job ${jobRes.status}: ${(await jobRes.text()).slice(0, 300)}`);
        const job = await jobRes.json();
        if (job.status === 'done') {
          if (!job.answer?.trim()) throw new Error('gateway devolveu resposta vazia');
          return job.answer;
        }
        if (job.status === 'error') throw new Error(`gateway: ${String(job.error).slice(0, 300)}`);
      }
    },
  },

  // ── Modos CLI (assinatura, sem API key) ──────────────────────────────────
  // Rodam no servidor local (192.168.1.11) autenticados via OAuth das
  // assinaturas Claude Pro/Max e ChatGPT Plus — estágio 2 de graça na fase
  // de validação. Timeout generoso: modelos com thinking levam minutos.
  'claude-cli': {
    envKey: null,
    modeloPadrao: '', // vazio = modelo padrão da assinatura; CLAUDE_CLI_MODEL sobrescreve
    async chamar(prompt, modelo) {
      const args = ['-p', prompt, '--output-format', 'text'];
      if (modelo) args.push('--model', modelo);
      return executarCli('claude', args);
    },
  },
  'codex-cli': {
    envKey: null,
    modeloPadrao: '', // CODEX_CLI_MODEL sobrescreve
    async chamar(prompt, modelo) {
      const args = ['exec', '--skip-git-repo-check', prompt];
      if (modelo) args.push('-m', modelo);
      return executarCli('codex', args);
    },
  },
};

/** Chama um CLI de IA (claude/codex) e devolve o texto da resposta. */
async function executarCli(binario, args) {
  const { execFile } = await import('node:child_process');
  return new Promise((resolvePromise, reject) => {
    execFile(
      binario,
      args,
      { maxBuffer: 32 * 1024 * 1024, timeout: 20 * 60 * 1000 },
      (erro, stdout, stderr) => {
        if (erro) {
          reject(new Error(`${binario} CLI falhou: ${erro.message} ${String(stderr).slice(0, 300)}`));
        } else if (!stdout.trim()) {
          reject(new Error(`${binario} CLI devolveu resposta vazia`));
        } else {
          resolvePromise(stdout);
        }
      }
    );
  });
}

const provider = (process.env.PROVIDER ?? 'gateway').toLowerCase();
// Política do usuário (13/09/2026): antes de pesquisa, escrita ou geração.
// Adaptadores históricos abaixo ficam bloqueados, sem flag de fallback.
if (provider !== 'gateway') {
  console.error('IA_GATEWAY_ONLY: somente PROVIDER=gateway está autorizado. APIs de IA e CLIs diretos estão bloqueados.');
  process.exit(1);
}
if (!process.env.IA_GATEWAY_URL || !process.env.IA_GATEWAY_TOKEN) {
  console.error('IA_GATEWAY_ONLY: configure IA_GATEWAY_URL e IA_GATEWAY_TOKEN no ambiente local. Não há fallback.');
  process.exit(1);
}
const cfg = PROVEDORES[provider];
if (!cfg) {
  console.error(`PROVIDER "${provider}" desconhecido. Use: ${Object.keys(PROVEDORES).join(', ')}.`);
  process.exit(1);
}
// Provedores CLI (assinatura via OAuth) não usam API key.
const apiKey = cfg.envKey ? process.env[cfg.envKey] : null;
if (cfg.envKey && !apiKey) {
  console.error(`${cfg.envKey} não definida (provider ${provider}).`);
  process.exit(1);
}

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const saida = resolve(process.argv[2] ?? root);
const config = JSON.parse(readFileSync(join(root, 'prompts/especialidades.json'), 'utf8'));
const template = readFileSync(join(root, 'prompts/boletim.md'), 'utf8');
const history = loadHistory(join(root,'prompts/published-articles.json'));
// Hífens viram underscore no nome da env (claude-cli → CLAUDE_CLI_MODEL).
const modelo =
  process.env[`${provider.toUpperCase().replaceAll('-', '_')}_MODEL`] ??
  (provider === 'claude' ? config.edicaoPadrao.modelo : cfg.modeloPadrao);

/** Data da edição em America/Sao_Paulo (o cron roda em UTC). */
const dataIso = editionDate();
const [anoEdicao, mesEdicao, diaEdicao] = dataIso.split('-');
const dataExtenso = `${Number(diaEdicao)} de ${MESES[Number(mesEdicao) - 1]} de ${anoEdicao}`;
const materiais = new Map();
const promptsMontados = new Map();
const evidenceDir = join(saida, 'evidencias');
mkdirSync(evidenceDir, { recursive: true });

function salvarRascunho(slug, text, destination = saida) {
  const html = extrairHtml(text) + '\n';
  const material = materiais.get(slug);
  if (!material) throw new Error('Material de origem ausente.');
  const result = validateEditorial(html, material, dataIso);
  const name = `boletim-${slug}-${dataIso}`;
  const novelty=validateUnpublished(html,material,history,name+'.html');
  const coverage=validateCoverage(html,config.especialidades.find(e=>e.slug===slug));
  result.errors.push(...novelty.errors,...coverage.errors);
  result.warnings.push(...coverage.warnings);
  result.coverage=coverage.coverage;
  result.ok=!result.errors.length;
  writeFileSync(join(evidenceDir, `${name}.validation.json`), JSON.stringify(result, null, 2) + '\n');
  if (!result.ok) {
    writeFileSync(join(evidenceDir, `${name}.rejected.txt`), html);
    throw new Error(`Contrato editorial: ${result.errors.join(' | ')}`);
  }
  const target = join(destination, `${name}.html`);
  writeFileSync(`${target}.pending`, html);
  renameSync(`${target}.pending`, target);
}

async function montarPrompt(esp) {
  if (promptsMontados.has(esp.slug)) return promptsMontados.get(esp.slug);
  // Estágio 1 (grátis): material verificado do PubMed (com contagem real de
  // citações via OpenAlex) + notícias regulatórias de FDA/ANVISA — a IA só redige.
  let material = '(Especialidade sem query PubMed configurada — gere menos itens.)';
  let diversity='';
  if (esp.pubmed) {
      const report=await collectWeekly(esp,history,`boletim-${esp.slug}-${dataIso}.html`);
      writeFileSync(join(evidenceDir,`selecao-${esp.slug}-${dataIso}.json`),JSON.stringify(report,null,2)+'\n');
      const itens = await enriquecerCitacoes(report.selected);
      material = formatarParaPrompt(itens);
      diversity=coverageInstructions(esp,report);
      console.log(`  PubMed: ${itens.length} candidatos inéditos; ${report.excluded.length} ocorrências já publicadas excluídas para ${esp.slug}`);
  }
  const noticias = await regulatorio(esp.regulatorioKeywords ?? [], 30, esp.regulatorioKeywordsPt ?? esp.regulatorioKeywords ?? []);
  if (noticias.length) console.log(`  Regulatório: ${noticias.length} notícia(s) para ${esp.slug}`);
  material += `\n\nNOTÍCIAS REGULATÓRIAS (FDA/ANVISA — verificadas, podem virar itens com tag t-reg "Regulatório"):\n${formatarRegulatorio(noticias)}`;
  material += '\n';
  materiais.set(esp.slug, material);
  writeFileSync(join(evidenceDir, `material-${esp.slug}-${dataIso}.md`), material);
  const prompt = template
    .replaceAll('{{NOME}}', esp.nome)
    .replaceAll('{{SLUG}}', esp.slug)
    .replaceAll('{{COR}}', esp.cor ?? '#1d4ed8')
    .replaceAll('{{DATA_EXTENSO}}', dataExtenso)
    .replaceAll('{{DATA_ISO}}', dataIso)
    .replaceAll('{{FOCO}}', esp.foco)
    .replaceAll('{{QTD}}', String(config.edicaoPadrao.artigosPorBoletim))
    .replaceAll('{{MATERIAL}}', material) + diversity;
  promptsMontados.set(esp.slug, prompt);
  return prompt;
}

// ── Estimativa de custo (roadmap 2.12 — alerta semanal no PR) ─────────────
// Tabela pública de preços (US$ por 1M tokens, input/output). Modelos sem
// preço conhecido (Kimi, CLIs de assinatura) entram como null = sem estimativa.
const PRECOS = {
  'gpt-5-mini': { in: 0.25, out: 2.0 },
  'gpt-5': { in: 1.25, out: 10.0 },
  'claude-sonnet-4-5': { in: 3.0, out: 15.0 },
};
/** Usos registrados pelas chamadas: { modelo, input, output, batch }. */
const usos = [];

function registrarUso(modelo, usage, batch = false) {
  if (!usage) return;
  const input = usage.input_tokens ?? usage.prompt_tokens ?? 0;
  const output = usage.output_tokens ?? usage.completion_tokens ?? 0;
  usos.push({ modelo, input, output, batch });
}

function estimarCusto() {
  let total = 0;
  let conhecido = false;
  for (const u of usos) {
    const preco = PRECOS[u.modelo];
    if (!preco) continue;
    conhecido = true;
    const fator = u.batch ? 0.5 : 1; // Batch API = 50% off
    total += ((u.input * preco.in + u.output * preco.out) / 1_000_000) * fator;
  }
  return conhecido ? total : null;
}

/** Resume o custo da run em texto (PR do rascunho) e alerta se passar do teto. */
function relatarCusto(saidaDir, dataIsoEdicao) {
  const total = estimarCusto();
  const teto = Number(process.env.CUSTO_ALERTA_USD ?? 0.1);
  const linhas = usos.map(
    (u) => `- ${u.modelo}${u.batch ? ' (batch −50%)' : ''}: ${u.input + u.output} tokens`
  );
  const texto = total == null
    ? 'Custo estimado: n/d (provedor sem tabela de preços ou assinatura OAuth)'
    : `Custo estimado da geração: **US$ ${total.toFixed(4)}** (teto de alerta: US$ ${teto.toFixed(2)})`;
  console.log(texto.replace(/\*\*/g, ''));
  linhas.forEach((l) => console.log(l));
  writeFileSync(join(saidaDir, `custo-${dataIsoEdicao}.md`), `${texto}\n\n${linhas.join('\n')}\n`);
  if (total != null && total > teto) {
    console.log(`::warning::Custo estimado US$ ${total.toFixed(4)} acima do teto de US$ ${teto.toFixed(2)}`);
  }
}

/** Extrai só o documento, mesmo se o modelo enrolar em cercas de código. */
function extrairHtml(texto) {
  const match = texto.trim().match(/<!doctype html[\s\S]*<\/html>/i);
  if (!match) throw new Error('resposta sem HTML completo');
  return match[0];
}

/** Extrai o texto de um corpo de resposta da OpenAI Responses API. */
function openaiExtrairTexto(data) {
  if (data.output_text) return data.output_text;
  return (data.output ?? [])
    .flatMap((item) => item.content ?? [])
    .filter((c) => c.type === 'output_text')
    .map((c) => c.text)
    .join('\n');
}

/**
 * Batch API da OpenAI (roadmap 2.12): 50% de desconto, janela de 24h — como a
 * geração semanal não é urgente, trocamos latência por custo. Envia UM batch
 * com um request por especialidade, faz polling e grava os HTMLs. Em caso de
 * falha/expiração do batch, o chamador cai no modo síncrono (fallback).
 */
async function gerarViaBatchOpenAI(ativas, modelo, apiKey, saidaDir, dataIsoEdicao) {
  const headers = { authorization: `Bearer ${apiKey}`, 'content-type': 'application/json' };

  // 1. Monta os prompts (estágio 1 PubMed/FDA roda aqui, grátis) e o JSONL.
  const linhas = [];
  for (const esp of ativas) {
    const prompt = await montarPrompt(esp);
    linhas.push(JSON.stringify({
      custom_id: esp.slug,
      method: 'POST',
      url: '/v1/responses',
      body: { model: modelo, input: prompt },
    }));
  }

  // 2. Upload do arquivo de entrada.
  const form = new FormData();
  form.append('purpose', 'batch');
  form.append('file', new Blob([linhas.join('\n') + '\n'], { type: 'application/jsonl' }), 'boletins.jsonl');
  const upRes = await fetch('https://api.openai.com/v1/files', {
    method: 'POST',
    headers: { authorization: `Bearer ${apiKey}` },
    body: form,
  });
  if (!upRes.ok) throw new Error(`upload ${upRes.status}: ${(await upRes.text()).slice(0, 300)}`);
  const inputFile = await upRes.json();

  // 3. Cria o batch.
  const batchRes = await fetch('https://api.openai.com/v1/batches', {
    method: 'POST',
    headers,
    body: JSON.stringify({
      input_file_id: inputFile.id,
      endpoint: '/v1/responses',
      completion_window: '24h',
    }),
  });
  if (!batchRes.ok) throw new Error(`batch ${batchRes.status}: ${(await batchRes.text()).slice(0, 300)}`);
  let batch = await batchRes.json();
  console.log(`  Batch ${batch.id} criado (${ativas.length} especialidades, ~50% off)`);

  // 4. Polling — batches pequenos costumam fechar em minutos; o teto evita
  //    travar o job do Actions (padrão 55 min, BATCH_TIMEOUT_MIN sobrescreve).
  const tetoMs = Number(process.env.BATCH_TIMEOUT_MIN ?? 55) * 60 * 1000;
  const inicio = Date.now();
  while (!['completed', 'failed', 'expired', 'cancelled'].includes(batch.status)) {
    if (Date.now() - inicio > tetoMs) throw new Error(`batch não concluiu em ${tetoMs / 60000} min (status ${batch.status})`);
    await new Promise((r) => setTimeout(r, 30000));
    const stRes = await fetch(`https://api.openai.com/v1/batches/${batch.id}`, { headers });
    if (!stRes.ok) throw new Error(`status ${stRes.status}: ${(await stRes.text()).slice(0, 300)}`);
    batch = await stRes.json();
    console.log(`  Batch ${batch.id}: ${batch.status}`);
  }
  if (batch.status !== 'completed') throw new Error(`batch terminou com status ${batch.status}`);

  // 5. Baixa a saída e grava um HTML por especialidade.
  const outRes = await fetch(`https://api.openai.com/v1/files/${batch.output_file_id}/content`, { headers });
  if (!outRes.ok) throw new Error(`saída ${outRes.status}: ${(await outRes.text()).slice(0, 300)}`);
  const erros = [];
  let geradosBatch = 0;
  for (const linha of (await outRes.text()).trim().split('\n')) {
    const item = JSON.parse(linha);
    const arquivo = `boletim-${item.custom_id}-${dataIsoEdicao}.html`;
    try {
      if (item.response?.status_code !== 200) {
        throw new Error(`request ${item.custom_id} falhou: ${item.response?.status_code}`);
      }
      registrarUso(modelo, item.response.body?.usage, true);
      salvarRascunho(item.custom_id, openaiExtrairTexto(item.response.body), saidaDir);
      console.log(`✔ ${arquivo} (batch)`);
      geradosBatch++;
    } catch (erro) {
      console.error(`✘ ${arquivo}: ${erro.message}`);
      erros.push(item.custom_id);
    }
  }
  return { gerados: geradosBatch, falhas: erros };
}

const ativas = config.especialidades.filter((e) => e.ativa);
console.log(`Edição de ${dataExtenso} — provider ${provider}, modelo ${modelo}, ${ativas.length} especialidade(s)`);

// Modo Batch (só OpenAI, env OPENAI_BATCH=1): 50% off, polling com teto; se o
// batch falhar/expirar, cai no modo síncrono — boletim da semana não fica sem.
let gerados = 0;
const usarBatch = provider === 'openai' && process.env.OPENAI_BATCH === '1';
const pendentes = new Set(ativas.map((e) => e.slug));
if (usarBatch) {
  try {
    const resultado = await gerarViaBatchOpenAI(ativas, modelo, apiKey, saida, dataIso);
    gerados += resultado.gerados;
    // Só as especialidades que o batch não entregou seguem para o modo síncrono.
    for (const esp of ativas) {
      if (!resultado.falhas.includes(esp.slug)) pendentes.delete(esp.slug);
    }
  } catch (erro) {
    console.warn(`… Batch falhou (${erro.message}) — caindo no modo síncrono`);
  }
}

for (const esp of ativas.filter((e) => pendentes.has(e.slug))) {
  const arquivo = `boletim-${esp.slug}-${dataIso}.html`;
  let feito = false;
  // Até 2 tentativas: com busca web no loop, a resposta pode vir truncada
  // (max_tokens) ou pausada — uma segunda chamada costuma completar.
  for (let tentativa = 1; tentativa <= 2 && !feito; tentativa++) {
    try {
      const texto = await cfg.chamar(await montarPrompt(esp), modelo, apiKey);
      salvarRascunho(esp.slug, texto);
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
relatarCusto(saida, dataIso);
if (gerados === 0) process.exit(1);
