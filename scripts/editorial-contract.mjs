import { createHash } from 'node:crypto';
const strip = (s) =>
  s
    .replace(/<[^>]*>/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
const attr = (s, name) =>
  s.match(new RegExp(name + '=["\\x27]([^"\\x27]*)["\\x27]', 'i'))?.[1] ?? '';
export function editionDate(now = new Date()) {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Sao_Paulo',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(now);
  const get = (type) => parts.find((p) => p.type === type).value;
  return get('year') + '-' + get('month') + '-' + get('day');
}
// Canonical newlines make evidence hashes portable across Git CRLF/LF checkouts.
export const digest = (text) =>
  createHash('sha256').update(text.replace(/\r\n/g, '\n')).digest('hex');
export function normalizeUrl(raw) {
  try {
    const url = new URL(raw.replace(/&amp;/g, '&').replace(/[.,;]+$/, ''));
    if (!['https:', 'http:'].includes(url.protocol)) return '';
    if (url.hostname === 'dx.doi.org') url.hostname = 'doi.org';
    url.protocol = 'https:';
    url.hash = '';
    return (
      url.hostname +
      url.pathname.replace(/\/$/, '') +
      url.search
    ).toLowerCase();
  } catch {
    return '';
  }
}
// Numbered material records are deliberately bounded by the next record.
export function materialSources(material) {
  const starts = [...material.matchAll(/^\[([R]?\d+)\]/gm)];
  return starts.map((m, i) => {
    const text = material.slice(
      m.index,
      starts[i + 1]?.index ?? material.length,
    );
    const urls = [...text.matchAll(/https?:\/\/[^\s<>"']+/g)].map((m) =>
      normalizeUrl(m[0].replace(/\)$/, '')),
    );
    for (const m of text.matchAll(/\bDOI:\s*(10\.\d{4,9}\/[^\s·]+)/g))
      urls.push(normalizeUrl('https://doi.org/' + m[1]));
    return {
      id: m[1],
      text,
      urls: [...new Set(urls.filter(Boolean))],
      level: /SÓ METADADOS/.test(text)
        ? 'metadata'
        : /TRUNCADO/.test(text)
          ? 'truncated'
          : /resumo INTEGRAL/.test(text)
            ? 'abstract'
            : 'regulatory-summary',
    };
  });
}
export function validateEditorial(html, material, date) {
  const errors = [],
    warnings = [],
    sources = materialSources(material);
  const approvedUrls = new Set(sources.flatMap((s) => s.urls));
  if (!/^<!doctype html/i.test(html.trim()) || !/<\/html>\s*$/i.test(html))
    errors.push('HTML incompleto.');
  const opening = html.match(/<html\b[^>]*>/i)?.[0] ?? '';
  if (attr(opening, 'data-editorial-version') !== '2')
    errors.push('Contrato editorial v2 ausente.');
  if (attr(opening, 'data-edition') !== date)
    errors.push('Data da edição diferente do arquivo.');
  const header = html.match(/<header\b[^>]*>[\s\S]*?<\/header>/i)?.[0] ?? '';
  if (!header.includes(date))
    errors.push('O cabeçalho deve exibir a data ISO da edição.');
  const title = strip(
    html.match(/<title[^>]*>([\s\S]*?)<\/title>/i)?.[1] ?? '',
  );
  if (!title.includes(date))
    errors.push('O título deve incluir a mesma data ISO da edição.');
  if (!/@media\s*\(prefers-color-scheme:\s*dark\)/.test(html))
    errors.push('Tema escuro ausente.');
  for (const section of [
    'Essencial',
    'Outras novidades',
    'Fontes consultadas',
  ]) {
    if (!html.includes(section)) errors.push('Seção ausente: ' + section);
  }
  if (/\bFAMERP\b/i.test(html))
    errors.push('Identificação pessoal/institucional proibida.');
  if (/\bPrática muda\b/i.test(html))
    errors.push(
      'Use Potencial impacto; a IA não pode conceder aprovação clínica.',
    );
  if (/revis[aã]o humana antes da publica[cç][aã]o/i.test(html))
    errors.push('Não declarar revisão humana em rascunho gerado.');
  const matches = [...html.matchAll(/<div\b[^>]*class=["']item["'][^>]*>/g)];
  if (!matches.length)
    errors.push(
      'Nenhum item com evidência disponível. Não publicar edição vazia.',
    );
  const primaryIds = new Set();
  const itemUrls = new Set();
  matches.forEach((match, index) => {
    const finalStart = html.indexOf('<div class="fontes-finais"', match.index);
    const chunk = html.slice(
      match.index,
      matches[index + 1]?.index ?? (finalStart >= 0 ? finalStart : html.length),
    );
    const id = attr(match[0], 'data-source-id');
    const kind = attr(match[0], 'data-kind');
    const source = sources.find((s) => s.id === id);
    const prefix = 'Item ' + (index + 1) + ': ';
    if (!source) errors.push(prefix + 'fonte principal ausente no material.');
    if (primaryIds.has(id)) errors.push(prefix + 'fonte principal repetida.');
    primaryIds.add(id);
    const prior = html.slice(0, match.index),
      headings = [
        ...prior.matchAll(/<h2\b[^>]*class=["']sec["'][^>]*>([\s\S]*?)<\/h2>/g),
      ];
    const essential = /Essencial/.test(strip(headings.at(-1)?.[1] ?? ''));
    if (essential && source && source.level !== 'abstract')
      errors.push(
        prefix +
          'Essencial exige resumo integral; material parcial fica em nota breve.',
      );
    if (!['analysis', 'brief'].includes(kind))
      errors.push(prefix + 'data-kind deve ser analysis ou brief.');
    if (source && source.level !== 'abstract' && kind !== 'brief')
      errors.push(prefix + 'material parcial exige nota breve.');
    if (essential && kind !== 'analysis')
      errors.push(prefix + 'Essencial exige análise completa.');
    const headingsRequired =
      kind === 'brief'
        ? ['Fontes']
        : [
            'Contexto',
            'Desenho e achados|O que mudou|Principais recomendações',
            'Implicação prática',
            'Limitações',
            'Fontes',
          ];
    for (const heading of headingsRequired)
      if (!new RegExp('<h4[^>]*>(' + heading + ')[^<]*</h4>').test(chunk))
        errors.push(prefix + 'bloco ausente: ' + heading);
    if (!/class=["']tag(?:\s|["'])/.test(chunk))
      errors.push(prefix + 'badge temática ausente.');
    if (
      !/<button\b[^>]*class=["']head["']/.test(chunk) ||
      !/<h3[^>]*>[^<]+/.test(chunk)
    )
      errors.push(prefix + 'cabeçalho de artigo ausente.');
    if (!/class=["']resumo["']/.test(chunk) || !/class=["']det["']/.test(chunk))
      errors.push(prefix + 'resumo/detalhamento ausente.');
    const links = [...chunk.matchAll(/<a\b[^>]*href=["']([^"']+)["']/g)].map(
      (m) => normalizeUrl(m[1]),
    );
    if (!links.length) errors.push(prefix + 'nenhuma fonte clicável.');
    if (source && !links.some((url) => source.urls.includes(url)))
      errors.push(prefix + 'fonte principal não está citada.');
    for (const url of links) {
      itemUrls.add(url);
      if (!approvedUrls.has(url))
        errors.push(prefix + 'link não consta no material: ' + url);
    }
    const summary = strip(
      chunk.match(/<p\b[^>]*class=["']resumo["'][^>]*>([\s\S]*?)<\/p>/)?.[1] ??
        '',
    );
    if (summary.split(/\s+/).length > 75)
      warnings.push(prefix + 'resumo longo; prefira 40–65 palavras.');
  });
  const final =
    html.match(
      /<div class=["']fontes-finais["']>([\s\S]*?)<p class=["']nota["']/,
    )?.[1] ?? '';
  const finalUrls = new Set(
    [...final.matchAll(/<a\b[^>]*href=["']([^"']+)["']/g)].map((m) =>
      normalizeUrl(m[1]),
    ),
  );
  for (const url of itemUrls)
    if (!finalUrls.has(url))
      errors.push('Referência ausente na lista final: ' + url);
  for (const url of finalUrls)
    if (!itemUrls.has(url))
      errors.push('Referência final não citada nos itens: ' + url);
  return {
    ok: !errors.length,
    errors,
    warnings,
    items: matches.length,
    materialSha256: digest(material),
    htmlSha256: digest(html),
    clinicalReview: 'pending',
  };
}
