#!/usr/bin/env node
/**
 * Gera UM boletim de exemplo local via IA Gateway (assinatura OAuth — custo
 * zero, não é "geração paga"). Usado para validar revisões do prompt editorial
 * sem tocar em feed.json, PRs ou publicação.
 *
 * Uso:
 *   node scripts/gerar-exemplo.mjs submit <slug> <pasta-saida>   # pesquisa (grátis) e envia o job
 *   node scripts/gerar-exemplo.mjs poll <slug> <pasta-saida>     # consulta; grava o HTML ao concluir
 *
 * Env: IA_GATEWAY_URL (obrigatória — endpoint do gateway NÃO fica no repo),
 *      IA_GATEWAY_TOKEN (obrigatória), IA_GATEWAY_PROVIDER (padrão claude).
 */
import { readFileSync, writeFileSync, mkdirSync, existsSync } from 'node:fs';
import { join, dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

import { pesquisar, formatarParaPrompt, enriquecerCitacoes } from './pubmed.mjs';
import { regulatorio, formatarRegulatorio } from './fontes-extra.mjs';

const MESES = ['janeiro','fevereiro','março','abril','maio','junho','julho','agosto','setembro','outubro','novembro','dezembro'];
const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const [cmd, slug, saidaArg] = process.argv.slice(2);
if (!cmd || !slug || !saidaArg) {
  console.error('uso: gerar-exemplo.mjs submit|poll <slug> <pasta-saida>');
  process.exit(1);
}
const saida = resolve(saidaArg);
const jobFile = join(saida, `${slug}.job.json`);
const base = (process.env.IA_GATEWAY_URL ?? (() => { throw new Error('IA_GATEWAY_URL não definida — endpoint do gateway não fica no repo'); })()).replace(/\/$/, '');
const token = process.env.IA_GATEWAY_TOKEN;
if (!token) { console.error('IA_GATEWAY_TOKEN não definida'); process.exit(1); }
const headers = { 'X-Token': token, 'content-type': 'application/json' };

const config = JSON.parse(readFileSync(join(root, 'prompts/especialidades.json'), 'utf8'));
const esp = config.especialidades.find((e) => e.slug === slug);
if (!esp) { console.error(`especialidade "${slug}" não existe no config`); process.exit(1); }

const agora = new Date(new Date().toLocaleString('en-US', { timeZone: 'America/Sao_Paulo' }));
const dataIso = agora.toISOString().slice(0, 10);
const dataExtenso = `${agora.getDate()} de ${MESES[agora.getMonth()]} de ${agora.getFullYear()}`;

if (cmd === 'submit') {
  mkdirSync(saida, { recursive: true });
  // Estágio 1 idêntico ao pipeline oficial (grátis e determinístico).
  let material = '(Especialidade sem query PubMed configurada — gere menos itens.)';
  if (esp.pubmed) {
    const itens = await enriquecerCitacoes(await pesquisar(esp.pubmed, 30, 25));
    material = formatarParaPrompt(itens);
    console.log(`PubMed: ${itens.length} artigo(s)`);
  }
  const noticias = await regulatorio(esp.regulatorioKeywords ?? [], 30);
  material += `\n\nNOTÍCIAS REGULATÓRIAS (FDA/ANVISA — verificadas):\n${formatarRegulatorio(noticias)}`;
  const prompt = readFileSync(join(root, 'prompts/boletim.md'), 'utf8')
    .replaceAll('{{NOME}}', esp.nome)
    .replaceAll('{{SLUG}}', esp.slug)
    .replaceAll('{{COR}}', esp.cor ?? '#1d4ed8')
    .replaceAll('{{DATA_EXTENSO}}', dataExtenso)
    .replaceAll('{{DATA_ISO}}', dataIso)
    .replaceAll('{{FOCO}}', esp.foco)
    .replaceAll('{{QTD}}', String(config.edicaoPadrao.artigosPorBoletim))
    .replaceAll('{{MATERIAL}}', material);
  // Registro do material efetivamente usado (entregável do brief).
  writeFileSync(join(saida, `material-${slug}-${dataIso}.md`), material);
  const res = await fetch(`${base}/ask`, {
    method: 'POST', headers,
    body: JSON.stringify({
      provider: process.env.IA_GATEWAY_PROVIDER ?? 'claude',
      model: process.env.IA_GATEWAY_MODEL ?? 'fable',
      prompt,
      mode: 'ask',
    }),
  });
  if (!res.ok) { console.error(`/ask ${res.status}: ${(await res.text()).slice(0, 300)}`); process.exit(1); }
  const { id } = await res.json();
  writeFileSync(jobFile, JSON.stringify({ id, dataIso }, null, 2));
  console.log(`job ${id} enviado (${slug}, prompt de ${prompt.length} chars). Rode: poll ${slug} ${saidaArg}`);
} else if (cmd === 'poll') {
  if (!existsSync(jobFile)) { console.error('sem job pendente — rode submit antes'); process.exit(1); }
  const { id, dataIso: dataJob } = JSON.parse(readFileSync(jobFile, 'utf8'));
  const teto = Date.now() + 260 * 1000; // cabe no timeout do Bash; rode de novo se não concluir
  for (;;) {
    const res = await fetch(`${base}/job/${id}`, { headers });
    if (!res.ok) { console.error(`/job ${res.status}`); process.exit(1); }
    const job = await res.json();
    if (job.status === 'done') {
      const match = (job.answer ?? '').trim().match(/<!doctype html[\s\S]*<\/html>/i);
      if (!match) { console.error('resposta sem HTML completo'); process.exit(1); }
      const arquivo = join(saida, `boletim-${slug}-${dataJob}-exemplo.html`);
      writeFileSync(arquivo, match[0] + '\n');
      console.log(`✔ ${arquivo} (${(match[0].length / 1024).toFixed(1)} KB, ${job.elapsed?.toFixed(0)}s)`);
      process.exit(0);
    }
    if (job.status === 'error') { console.error(`erro: ${String(job.error).slice(0, 300)}`); process.exit(1); }
    if (Date.now() > teto) { console.log(`ainda ${job.status} — rode poll de novo`); process.exit(2); }
    await new Promise((r) => setTimeout(r, 2000));
  }
}
