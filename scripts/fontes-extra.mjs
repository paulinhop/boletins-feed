/**
 * Fontes fora do PubMed (estágio 1, custo zero): notícias regulatórias de
 * agências via RSS público — FDA (press announcements) e ANVISA (gov.br).
 *
 * Por que existe: press releases e comunicados regulatórios nem sempre viram
 * artigo indexado no PubMed; sem esta fonte, o pipeline perderia o bloco
 * "Regulatório". Falha de uma fonte não derruba a geração (só avisa).
 */

const FONTES = [
  { nome: 'FDA (press)', url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/press-releases/rss.xml' },
  { nome: 'FDA (drugs)', url: 'https://www.fda.gov/about-fda/contact-fda/stay-informed/rss-feeds/drugs/rss.xml' },
  // ANVISA: o gov.br não expõe RSS da editoria de notícias — quando virar
  // prioridade, implementar scraping da listagem (roadmap 2.11).
];

function texto(xml, tag) {
  const m = xml.match(new RegExp(`<${tag}[^>]*>([\\s\\S]*?)</${tag}>`));
  return m ? m[1].replace(/<!\[CDATA\[|\]\]>/g, '').replace(/<[^>]+>/g, ' ').replace(/\s+/g, ' ').trim() : '';
}

/** Notícias dos últimos `dias` dias que batem em alguma das keywords. */
export async function regulatorio(keywords = [], dias = 30) {
  const corte = Date.now() - dias * 86400e3;
  const achados = [];
  for (const fonte of FONTES) {
    try {
      const res = await fetch(fonte.url, { headers: { 'User-Agent': 'boletim-med/1.0' } });
      if (!res.ok) throw new Error(`HTTP ${res.status}`);
      const xml = await res.text();
      for (const [item] of xml.matchAll(/<item>[\s\S]*?<\/item>/g)) {
        const titulo = texto(item, 'title');
        const descricao = texto(item, 'description');
        const data = new Date(texto(item, 'pubDate') || texto(item, 'date') || 0);
        if (isNaN(data.getTime()) || data.getTime() < corte) continue;
        const alvo = `${titulo} ${descricao}`.toLowerCase();
        if (keywords.length && !keywords.some((k) => alvo.includes(k.toLowerCase()))) continue;
        achados.push({ fonte: fonte.nome, titulo, descricao: descricao.slice(0, 600), data: data.toISOString().slice(0, 10), link: texto(item, 'link') });
      }
    } catch (erro) {
      console.warn(`  Fonte ${fonte.nome} falhou: ${erro.message} — seguindo sem ela`);
    }
  }
  return achados;
}

/** Formata as notícias regulatórias para o prompt editorial. */
export function formatarRegulatorio(noticias) {
  if (noticias.length === 0) return '(Nenhuma notícia regulatória relevante no período.)';
  return noticias
    .map((n, i) => `[R${i + 1}] ${n.titulo}\n    Fonte: ${n.fonte} · Data: ${n.data} · Link: ${n.link}\n    Resumo: ${n.descricao}`)
    .join('\n\n');
}
