# Boletins Feed

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

1. Coloque os `.html` da semana numa pasta local.
2. Gere o manifesto com o script do repo principal:
   `node scripts/build-feed.mjs <pasta>`
3. Suba os `.html` + `feed.json` aqui (pelo site do GitHub: *Add file → Upload files*,
   ou por git).

Documentação completa: `docs/feed.md` no repositório principal (privado) `boletim-med`.
