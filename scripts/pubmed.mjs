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
    return {
      pmid: texto(art, 'PMID'),
      titulo: texto(art, 'ArticleTitle'),
      periodico: texto(art, 'Title') || texto(art, 'ISOAbbreviation'),
      data: [texto(art, 'Year'), texto(art, 'Month'), texto(art, 'Day')].filter(Boolean).join(' '),
      autores,
      doi,
      resumo: todos(art, 'AbstractText').map((t) => t.replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim()).join(' ').slice(0, 1800),
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
        `    DOI: ${a.doi || 'n/a'} · PMID: ${a.pmid} (https://pubmed.ncbi.nlm.nih.gov/${a.pmid}/)`,
        a.resumo ? `    Resumo: ${a.resumo}` : '    (sem resumo no PubMed)',
      ].join('\n')
    )
    .join('\n\n');
}
