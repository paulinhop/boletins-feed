# Boletins Feed

**Atualização de 13/09/2026:** geração e publicação agora verificam o contrato editorial v2 e o material de origem. Veja [CONTRATO-EDITORIAL.md](CONTRATO-EDITORIAL.md). O formato de saída continua HTML; a validação mecânica não substitui revisão clínica. As edições existentes foram preservadas.

Repositório público de conteúdo do app **Boletim Médico** (Fase 2 — feed na nuvem).

O app lê o manifesto `feed.json` via `raw.githubusercontent.com` e baixa apenas os
boletins `.html` que ainda não existem no aparelho. Leitura 100% offline depois disso.

## Regras inegociáveis de publicação

- **Nunca** publicar boletins com nome de pessoas ou referência à FAMERP.
- Nome de arquivo padrão: `boletim-<slug>-AAAA-MM-DD.html`
  (ex.: `boletim-urologia-2026-08-25.html`). A especialidade e a data são detectadas
  pelo nome do arquivo — fora do padrão, o boletim cai em "Outros" no app.
- Todo boletim de teste deve estar rotulado como conteúdo fictício.

## Como publicar uma edição nova

### Geração local pelo gateway (política vigente — 13/09/2026)

O piloto e as revisões de versão estão restritos a **Urologia**. As demais especialidades ficam com geração desativada até aprovação do pipeline pelo revisor médico do piloto. As edições existentes permanecem preservadas até a limpeza final autorizada após a aprovação. O comparativo exploratório de modelos usa fontes e prompt congelados, com rascunhos privados no repositório do app; nenhum desses rascunhos deve ser adicionado ao feed antes da revisão.

O cron de geração foi retirado. O workflow **Gerar rascunho semanal** agora apenas informa a pausa; não recebe credenciais nem executa IA. O gateway privado não será exposto ao Actions.

O gerador aceita exclusivamente `PROVIDER=gateway` (também o padrão). Configure `IA_GATEWAY_URL` e `IA_GATEWAY_TOKEN` apenas no ambiente local. APIs de IA e CLIs diretos são rejeitados antes de pesquisa, geração ou escrita, sem fallback. Adaptadores anteriores estão preservados como código histórico bloqueado; sua presença não representa autorização de uso.

Execute `node scripts/gerar-boletins.mjs <pasta-saida>` no ambiente autorizado. As consultas bibliográficas/regulatórias existentes continuam separadas da execução de IA; não foram substituídas por referências inventadas pelo modelo. Nenhuma geração foi disparada ao implantar essa restrição.

A publicação continua após revisão clínica: rascunho → revisão → merge → **Publicar feed**. Não foram alterados HTMLs ou manifesto por essa mudança. Testes sem rede/IA: `node --test scripts/editorial-contract.test.mjs scripts/gateway-policy.test.mjs`.

### Manual (fallback)

1. Coloque os `.html` da semana numa pasta local.
2. Gere o manifesto: `node scripts/build-feed.mjs <pasta>`
3. Suba os `.html` + `feed.json` aqui (pelo site do GitHub: *Add file → Upload files*,
   ou por git).

Documentação completa: `docs/feed.md` no repositório principal (privado) `boletim-med`.
