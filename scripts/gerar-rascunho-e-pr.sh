#!/usr/bin/env bash
# Gera os rascunhos da edição (um provedor ou o comparativo A/B/C) e abre um PR
# por provedor. Chamado pelo workflow gerar-rascunho.yml; também roda local:
#   ESCOLHA=gateway bash scripts/gerar-rascunho-e-pr.sh
set -euo pipefail

ESCOLHA="${ESCOLHA:-gateway}"
if [ "$ESCOLHA" != "gateway" ]; then
  echo "IA_GATEWAY_ONLY: somente ESCOLHA=gateway está autorizado." >&2
  exit 1
fi
if [ -z "${IA_GATEWAY_URL:-}" ] || [ -z "${IA_GATEWAY_TOKEN:-}" ]; then
  echo "Configure IA_GATEWAY_URL e IA_GATEWAY_TOKEN localmente; não há fallback." >&2
  exit 1
fi
DATA=$(TZ=America/Sao_Paulo date +%F)

git config user.name "boletim-med-bot"
git config user.email "bot@users.noreply.github.com"

if [ "$ESCOLHA" = "todos" ]; then LISTA="claude openai kimi"; else LISTA="$ESCOLHA"; fi

for PROV in $LISTA; do
  # Provedores CLI (claude-cli, codex-cli) rodam com a assinatura via OAuth —
  # não têm secret; os demais exigem a env KEY correspondente.
  if [ "$PROV" = "claude-cli" ] || [ "$PROV" = "codex-cli" ]; then
    KEY_VAR=""
  elif [ "$PROV" = "gateway" ]; then
    # Gateway privado das assinaturas; endpoint e credenciais só no ambiente local.
    KEY_VAR="IA_GATEWAY_TOKEN"
  else
    KEY_VAR=$(echo "$PROV" | tr 'a-z' 'A-Z' | sed -e 's/KIMI/MOONSHOT/' -e 's/CLAUDE/ANTHROPIC/')_API_KEY
  fi
  if [ -n "$KEY_VAR" ] && [ -z "${!KEY_VAR:-}" ]; then
    echo "::warning::Secret $KEY_VAR ausente — pulando $PROV."
    continue
  fi

  PROVIDER=$PROV node scripts/gerar-boletins.mjs

  BRANCH="rascunho/$DATA-$PROV"
  git checkout -B "$BRANCH"
  git add boletim-*-"$DATA".html "custo-$DATA.md"
  git add "evidencias/material-"*"-$DATA.md" "evidencias/boletim-"*"-$DATA.validation.json"
  if git diff --cached --quiet; then
    echo "Nenhum boletim novo gerado por $PROV; sem PR."
    git checkout main
    continue
  fi
  git commit -m "Rascunho da edicao de $DATA ($PROV — pendente de revisao medica)"
  # -f: o branch de rascunho é descartável e pode já existir de um run anterior
  # no mesmo dia (re-geração após ajuste de template, por exemplo).
  git push -f -u origin "$BRANCH"

  # Se o PR do branch já existe (re-geração no mesmo dia), o push acima já o
  # atualizou — não tratar como erro.
  gh pr create --title "Rascunho: edição de $DATA [$PROV]" --body-file - <<EOF || echo "PR já existia; branch atualizado."
Boletins gerados automaticamente (**$PROV**; estágio 1 grátis: PubMed + OpenAlex + FDA/ANVISA).

$(cat "custo-$DATA.md" 2>/dev/null || echo "Custo estimado: n/d")

**Revisão médica obrigatória antes do merge** — verifique:
- referências reais e corretas (sem alucinação);
- linguagem e relevância clínica;
- sem nomes de pessoas nem referência à FAMERP.

No comparativo A/B/C, faça merge de **no máximo um** PR da edição; feche os
demais. Ao fazer merge, o workflow de publicação atualiza o \`feed.json\` e o
app passa a baixar a edição automaticamente. Para descartar, basta fechar o PR.
EOF

  git checkout main
  git branch -D "$BRANCH" 2>/dev/null || true
done
