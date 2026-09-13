# Seleção semanal: variedade e estudos inéditos

Decisão do usuário em 13/09/2026: versão A/Fable escolhida. Urologia deve variar entre andrologia, uro-oncologia, litíase, HPB, medicina sexual, consultório, geral e outros temas relevantes. **Não há quota obrigatória nem necessidade de cobrir todas as áreas em cada edição.** Qualidade e relevância precedem preenchimento de categorias.

## Pesquisa e seleção

`prompts/especialidades.json` define sete consultas PubMed. `collectWeekly` consulta cada recorte, combina as identidades e exclui publicações anteriores. Seleção em rodízio entre consultas limita a 40 candidatos sem deixar uma única busca ocupar todo o material. Datas continuam na janela de 30 dias; isso não autoriza repetir artigos de semanas anteriores. Falha de consulta aborta a pesquisa, não é apresentada como ausência de estudos.

O campo `ramosCandidatos` indica somente quais queries recuperaram a fonte, não sua classificação clínica. O redator identifica um único `data-subramo` principal por item; não pode contar o mesmo estudo duas vezes nem apresentar um desfecho secundário sexual de cirurgia de HPB como estudo próprio de medicina sexual. Matriz de cobertura e aviso de concentração ficam na validação editorial, sem acrescentar filtros/avisos por área ausente ao leitor. Cobertura inadequada pode demandar revisão humana, não preenchimento com estudos fracos.

## Histórico durável

`prompts/published-articles.json` é o registro de identidades publicadas, independente do catálogo atual. A carga inicial percorreu 15 snapshots de `feed.json` em main e 18 versões de HTML, incluindo edições removidas. Foram preservados 184 registros de artigo/versão (não 184 estudos únicos). Duas demonstrações explicitamente fictícias foram auditadas e excluídas. Não há documento histórico sem parser nesta carga. Isso registra exposição no feed, não certifica aprovação clínica antiga.

Comparação por DOI normalizado (inclusive URL, caixa e dx.doi.org), PMID e título normalizado. DOI/PMID são vinculados pela fonte principal do material; registros legados recuperam identidade da referência principal. Título é apoio conservador. Não há resolução externa completa de versões preprint/publicação com identificadores e títulos diferentes: esses casos precisam de revisão editorial. Só cobre o histórico disponível neste repositório; publicações externas não importadas não são presumidas conhecidas.

- **Antes da IA:** candidatos publicados são retirados e relatados em `evidencias/selecao-*.json`.
- **Depois da IA:** `salvarRascunho` confere a identidade da fonte principal e bloqueia repetição, mesmo se o modelo trocar título/link.
- **Antes do manifesto:** `build-feed.mjs` faz nova checagem contra o histórico atual. Só após validar todos os arquivos atualiza o registro e o manifesto. Ações de publicação versionam ambos. Remover um HTML não remove seu histórico.
- Corrigir a **mesma edição** é permitido, preservando as identidades anteriores; não é uma semana nova. Uma publicação de seguimento/correção precisa ter identidade própria e novidade explicitada. Acesso a outra URL do mesmo artigo não constitui novidade.
- Histórico ausente, corrompido ou com importação não auditada bloqueia o fluxo. Não apagar/reiniciar o registro para contornar duplicatas.

`node scripts/bootstrap-publication-history.mjs` reimporta main com Git completo e acrescenta ao registro existente. `node --test scripts/*.test.mjs` valida normalização, alias DOI/PMID, edições retiradas, consultas independentes, ausência de quotas e bloqueio da publicação duplicada sem alterar manifesto/histórico.

## Verificação desta entrega

31 testes aprovados. Pesquisa bibliográfica real em 13/09/2026: sete consultas, 40 candidatos após deduplicação/limite e 10 ocorrências já publicadas excluídas; as consultas de andrologia e medicina sexual retornaram candidatos. Contagens podem se sobrepor entre subramos; não são uma avaliação clínica nem garantia de pertinência.

Nenhuma nova inferência foi feita nesta etapa. O MVP preserva o conteúdo da A escolhida para teste visual; não foi reescrito retroativamente para se ajustar à pesquisa nova. Ele continua em revisão, com seis análises que precisam de Contexto e Implicação prática e com a identificação de comentário de diretriz a corrigir antes de publicação clínica. O validador de publicação permanece estrito; o empacotamento interno do MVP não o substitui. Geração semanal continua pausada, inferência exclusivamente pelo gateway privado.
