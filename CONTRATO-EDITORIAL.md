# Contrato editorial v2 — 13/09/2026

**Política de execução atual:** IA somente pelo gateway local, sem APIs diretas ou CLIs fora do gateway. O gerador usa gateway por padrão e rejeita demais opções antes de consultas/escritas; falta de configuração aborta sem fallback. Cron de geração no GitHub Actions removido; workflow manual só informa a pausa. O gateway permanece privado. Publicação/revisão do feed seguem ativas. 8 testes novos de bloqueio sem rede somados aos 13 testes editoriais passaram; nenhuma geração clínica foi executada nessa mudança.

O prompt continua gerando HTML compatível com o aplicativo, com todas as badges e análises aprofundadas para especialistas. A fonte principal de cada item é declarada em `data-source-id` e corresponde a um registro numerado do material recuperado. `data-kind` distingue análise de nota breve; `data-edition` fixa a data da edição.

O gerador salva os materiais em `evidencias/material-<slug>-<data>.md`, reutiliza o mesmo pacote nas tentativas e valida antes de gravar um HTML. Resultados reprovados ficam em `.rejected.txt`, fora do feed. O relatório `.validation.json` registra hashes com finais de linha normalizados e indica revisão clínica pendente. Os pacotes e relatórios aprovados acompanham o PR.

São verificadas estrutura, fontes clicáveis em cada item, identidade exata de DOI/PMID/URL, fonte principal única, coerência da lista final, datas, badges e elegibilidade do Essencial. Metadados, abstracts truncados e sinopses regulatórias ficam em notas breves. Um resumo integral não significa acesso ao artigo completo. A IA não pode declarar que seu rascunho recebeu revisão humana nem usar a badge conclusiva “Prática muda”; pode sinalizar “Potencial impacto”, com limites explícitos.

`build-feed.mjs` executa a validação antes de substituir o manifesto. As três edições existentes de 13/09 foram preservadas em `prompts/legacy-editions.json` por hash do texto normalizado; isso registra compatibilidade histórica, não uma nova certificação científica. Uma edição nova ou alterada não pode dispensar o contrato apenas removendo o atributo de versão. O workflow `validar-contrato.yml` testa o contrato e o manifesto em PRs e alterações de código/conteúdo. Torná-lo obrigatório por branch protection depende da configuração do repositório; não foi afirmado nem alterado aqui.

O manifesto e os HTMLs já publicados não foram alterados por esta entrega. Os cabeçalhos antigos com data diferente do nome do arquivo permanecem nos originais históricos; novos rascunhos devem apresentar a mesma data ISO no título, cabeçalho, atributo e nome do arquivo.

Pesquisa: PubMed com ordenação explícita `pub_date`, segundo a [documentação NCBI](https://www.ncbi.nlm.nih.gov/books/NBK25499/), e timeout de 20 segundos por requisição. ANVISA usa palavras-chave em português para Urologia/Ginecologia/Obstetrícia, normalizando acentos; FDA mantém as palavras em inglês. Isso melhora seleção determinística, mas não estabelece cobertura exaustiva da literatura.

Verificação: `node --test scripts/editorial-contract.test.mjs`; `node scripts/validar-boletim.mjs <html> <material>`; `node scripts/build-feed.mjs <pasta>`. Os testes são sintéticos, verificam contratos e bloqueios e não demonstram qualidade clínica de uma nova geração. Nenhuma chamada a modelo/geração paga foi disparada nesta implementação. Toda nova edição continua exigindo revisão clínica externa antes do merge.

A proposta JSON com rastreabilidade por afirmação permanece uma evolução posterior; não foi inserida isoladamente num gerador que espera HTML.
