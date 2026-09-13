# Geração de boletins no servidor local (192.168.1.11)

> **Documento histórico — não executar os comandos abaixo.** Desde 13/09/2026, toda execução de IA do projeto usa exclusivamente o gateway privado, sem APIs ou CLIs diretos. O cron de geração no Actions está pausado. O piloto atual gera somente Urologia, com comparação privada e revisão médica antes da publicação. A política vigente e a execução autorizada estão no [README](../README.md#geração-local-pelo-gateway-política-vigente--13092026). As referências abaixo a custo, modelos, produção e comandos descrevem o desenho anterior, não o estado atual.

O servidor 24/7 roda o estágio 2 (redação) via **assinatura** (Claude Pro/Max
ou ChatGPT Plus) autenticada por OAuth — custo zero na fase de validação.
O estágio 1 (PubMed/OpenAlex/FDA) já é gratuito em qualquer lugar.

> Rotina semanal de produção continua no GitHub Actions com `gpt-5-mini`
> (centavos, confiável, sem depender de PC/servidor ligado). O servidor é
> para **comparativos de qualidade** (Fable × GPT-5) e testes pesados.

## Setup (uma vez)

1. **Node 20+** e **git** instalados.
2. **CLIs de IA** autenticados com a assinatura:
   ```bash
   npm install -g @anthropic-ai/claude-code   # depois: claude  (login OAuth)
   npm install -g @openai/codex               # depois: codex login
   ```
3. **GitHub CLI** autenticado (para abrir o PR de revisão):
   ```bash
   gh auth login   # conta paulinhop, escopo repo
   ```
4. Clone do feed:
   ```bash
   git clone https://github.com/paulinhop/boletins-feed.git ~/boletins-feed
   ```

## Uso

```bash
cd ~/boletins-feed && git pull
ESCOLHA=claude-cli bash scripts/gerar-rascunho-e-pr.sh   # Claude (assinatura)
ESCOLHA=codex-cli  bash scripts/gerar-rascunho-e-pr.sh   # ChatGPT (assinatura)
ESCOLHA="claude-cli codex-cli" bash scripts/gerar-rascunho-e-pr.sh  # comparativo A/B
```

- O script gera o(s) boletim(ns), cria branch `rascunho/DATA-<provider>` e abre
  PR — a revisão médica e o merge seguem o mesmo fluxo do Actions.
- Modelo específico (opcional): `CLAUDE_CLI_MODEL=fable ESCOLHA=claude-cli ...`
  ou `CODEX_CLI_MODEL=gpt-5 ESCOLHA=codex-cli ...`.
- Timeout de 20 min por chamada (thinking de Fable/Opus é longo — normal).

## Comparativo mensal de qualidade (sugerido)

1ª semana do mês: rodar `claude-cli` e `codex-cli` no servidor → 2 PRs de
rascunho → revisão médica cega escolhe o melhor → merge de um, fecha o outro.
O resultado orienta se a rotina continua no `gpt-5-mini` ou se algum modelo
premium justifica API.
