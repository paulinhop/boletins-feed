/**
 * Pesquisa bibliográfica GRATUITA via PubMed E-utilities (NCBI, API pública).
 *
 * Por que existe: o loop de web_search da API de IA era o maior custo do
 * pipeline (cada rodada reenvia o contexto inteiro). Aqui a recuperação é
 * determinística e de graça — a IA cara só entra depois, para selecionar e
 * redigir (ver gerar-boletins.mjs e prompts/boletim.md).
 *
 * Uso:  import { pesquisar } from './pubmed.mjs'
 *       const itens = await pesquisar('"urology"[MeSH Terms]', 30, 40)
 */

const EUTILS = 'https://eutils.ncbi.nlm.nih.gov/entrez/eutils';

function texto(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

function todos(xml, tag) {
  return [...xml.matchAll(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`, 'g'))].map((m) => m[1]);
}

/** Busca artigos dos últimos `dias` dias. Retorna lista com metadados + resumo. */
export async function pesquisar(query, dias = 30, max = 40) {
  const hoje = new Date();
  const inicio = new Date(hoje.getTime() - dias * 86400e3);
  const fmt = (d) => `${d.getFullYear()}/${String(d.getMonth() + 1).padStart(2, '0')}/${String(d.getDate()).padStart(2, '0')}`;

  const esearch = `${EUTILS}/esearch.fcgi?db=pubmed&retmode=json&retmax=${max}` +
    `&datetype=pdat&mindate=${fmt(inicio)}&maxdate=${fmt(hoje)}` +
    `&term=${encodeURIComponent(query)}`;
  const res1 = await fetch(esearch);
  if (!res1.ok) throw new Error(`PubMed esearch HTTP ${res1.status}`);
  const ids = (await res1.json())?.esearchresult?.idlist ?? [];
  if (ids.length === 0) return [];

  const efetch = `${EUTILS}/efetch.fcgi?db=pubmed&retmode=xml&id=${ids.join(',')}`;
  const res2 = await fetch(efetch);
  if (!res2.ok) throw new Error(`PubMed efetch HTTP ${res2.status}`);
  const xml = await res2.text();

  return [...xml.matchAll(/<PubmedArticle>[\s\S]*?<\/PubmedArticle>/g)].map(([art]) => {
    const autores = [...art.matchAll(/<Author[\s>][\s\S]*?<\/Author>/g)]
      .slice(0, 6)
      .map(([a]) => `${texto(a, 'LastName')} ${texto(a, 'Initials')}`.trim())
      .filter(Boolean);
    const doi =
      art.match(/<ArticleId IdType="doi">([^<]+)</)?.[1] ??
      art.match(/<ELocationID EIdType="doi"[^>]*>([^<]+)</)?.[1] ??
      '';
    const resumoBruto = todos(art, 'AbstractText').map((t) => t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).join(' ');
    // Teto explícito e generoso (fidelidade à fonte). Abaixo dele o resumo
    // vai INTEGRAL; acima, marcado como TRUNCADO — nunca corte silencioso.
    const RESUMO_MAX = 4000;
    return {
      pmid: texto(art, 'PMID'),
      titulo: texto(art, 'ArticleTitle'),
      periodico: texto(art, 'Title') || texto(art, 'ISOAbbreviation'),
      data: [texto(art, 'Year'), texto(art, 'Month'), texto(art, 'Day')].filter(Boolean).join(' '),
      autores,
      doi,
      resumo: resumoBruto.slice(0, RESUMO_MAX),
      resumoStatus: !resumoBruto ? 'ausente' : resumoBruto.length > RESUMO_MAX ? 'truncado' : 'completo',
      tipos: todos(art, 'PublicationType').map((t) => t.replace(/<[^>]+>/g, '').trim()),
    };
  });
}

/** Formata a lista como material bruto para o prompt editorial. */
export function formatarParaPrompt(itens) {
  if (itens.length === 0) return '(Nenhum artigo encontrado no período — gere menos itens.)';
  return itens
    .map((a, i) =>
      [
        `[${i + 1}] ${a.titulo}`,
        `    Periódico: ${a.periodico} · Data: ${a.data} · Tipos: ${a.tipos.join(', ') || 'n/a'}`,
        `    Autores: ${a.autores.join(', ')}${a.autores.length >= 6 ? ' et al.' : ''}`,
        `    Citações (OpenAlex, dado auxiliar): ${a.citacoes ?? 'n/a'} · DOI: ${a.doi || 'n/a'} · PMID: ${a.pmid} (https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/)`,
        `    Material disponível: ${a.resumoStatus === 'completo' ? 'resumo INTEGRAL' : a.resumoStatus === 'truncado' ? 'resumo TRUNCADO (corte no limite de caracteres — o que não estiver escrito aqui NÃO foi verificado)' : 'SÓ METADADOS (sem resumo — usar apenas para menção breve ou omitir)'}`,
        a.resumo ? `    Resumo: ${a.resumo}` : '',
      ].filter(Boolean).join('\n')
    )
    .join('\n\n');
}

/**
 * Contagem real de citações via OpenAlex (API gratuita), em lote por DOI.
 * Preenche item.citacoes; falha silenciosa (citações ficam "n/a").
 */
export async function enriquecerCitacoes(itens) {
  const comDoi = itens.filter((a) => a.doi);
  if (comDoi.length === 0) return itens;
  try {
    const filtro = comDoi.map((a) => a.doi).join('|');
    const url = `https://api.openalex.org/works?per-page=50&filter=doi:${encodeURIComponent(filtro)}` +
      `&select=doi,cited_by_count&mailto=boletim-med@users.noreply.github.com`;
    const res = await fetch(url);
    if (!res.ok) throw new Error(`OpenAlex HTTP ${res.status}`);
    const porDoi = new Map(
      ((await res.json())?.results ?? []).map((w) => [String(w.doi).replace('https://doi.org/', '').toLowerCase(), w.cited_by_count])
    );
    for (const a of comDoi) {
      const n = porDoi.get(a.doi.toLowerCase());
      if (n !== undefined) a.citacoes = n;
    }
  } catch (erro) {
    console.warn(`  OpenAlex falhou: ${erro.message} — seleção segue sem contagem de citações`);
  }
  return itens;
}
