import test from 'node:test';
import assert from 'node:assert/strict';
import { mkdtempSync, mkdirSync, writeFileSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { spawnSync } from 'node:child_process';
import {
  editionDate,
  materialSources,
  validateEditorial,
} from './editorial-contract.mjs';
const material =
  '[1] Example study\n PMID: 123 (https://pubmed.ncbi.nlm.nih.gov/123/)\n DOI: 10.1000/example\n Material disponível: resumo INTEGRAL\n Resumo: Synthetic software test.\n\n[2] Metadata only\n PMID: 456 (https://pubmed.ncbi.nlm.nih.gov/456/)\n Material disponível: SÓ METADADOS\n';
const ref = '<a href="https://pubmed.ncbi.nlm.nih.gov/123/">Fonte</a>';
const html =
  '<!doctype html><html data-editorial-version="2" data-edition="2026-09-13"><head><title>Urologia — Boletim de 2026-09-13</title><style>@media (prefers-color-scheme: dark){}</style></head><body><header>2026-09-13</header><h2 class="sec">Essencial</h2><div class="item" data-source-id="1" data-kind="analysis"><span class="tag t-geral">Tema</span><button class="head"><h3>Exemplo sintético</h3></button><p class="resumo">Teste de software.</p><div class="det"><h4>Contexto</h4><p>Exemplo.</p><h4>Desenho e achados</h4><p>Exemplo.</p><h4>Implicação prática</h4><p>Exemplo.</p><h4>Limitações</h4><p>Exemplo.</p><h4>Fontes</h4>' +
  ref +
  '</div></div><h2 class="sec">Outras novidades</h2><h2 class="sec">Fontes consultadas</h2><div class="fontes-finais">' +
  ref +
  '</div><p class="nota">MedBrain</p></body></html>';
const validate = (text) => validateEditorial(text, material, '2026-09-13');
test('publication validates before replacing the previous manifest', () => {
  const dir = mkdtempSync(join(tmpdir(), 'medbrain-feed-contract-'));
  mkdirSync(join(dir, 'evidencias'));
  const file = join(dir, 'boletim-urologia-2026-09-13.html');
  writeFileSync(file, html);
  writeFileSync(join(dir, 'evidencias', 'material-urologia-2026-09-13.md'), material);
  const script = fileURLToPath(new URL('./build-feed.mjs', import.meta.url));
  const good = spawnSync(process.execPath, [script, dir], { encoding: 'utf8' });
  assert.equal(good.status, 0, good.stderr);
  const before = readFileSync(join(dir, 'feed.json'), 'utf8');
  writeFileSync(file, html.replaceAll(ref, ''));
  assert.equal(spawnSync(process.execPath, [script, dir]).status, 1);
  assert.equal(readFileSync(join(dir, 'feed.json'), 'utf8'), before);
  writeFileSync(file, html.replace('data-editorial-version="2"', ''));
  assert.equal(spawnSync(process.execPath, [script, dir]).status, 1);
  assert.equal(readFileSync(join(dir, 'feed.json'), 'utf8'), before);
});
test('valid sourced contract passes but clinical review remains pending', () => {
  const r = validate(html);
  assert.deepEqual(r.errors, []);
  assert.equal(r.clinicalReview, 'pending');
});

test('historical CSS comment is not mistaken for clinical approval, but a badge is blocked', () => {
  const withComment = html.replace('</style>', '/* Regulatório / diretriz / prática muda */</style>');
  assert.equal(validate(withComment).ok, true);
  assert.equal(validate(withComment.replace('>Tema</span>', '>Prática muda</span>')).ok, false);
  assert.equal(validate(html.replace('</style>', '.tag::after{content:"Prática muda"}</style>')).ok, false);
});

test('marking a complete abstract as brief cannot bypass required analytical blocks', () => {
  const brief = html.replace('>Essencial</h2>', '>Essencial</h2><h2 class="sec">Outras novidades</h2>').replace('data-kind="analysis"', 'data-kind="brief"');
  assert.equal(validate(brief).ok, true);
  const result = validate(brief.replace('<h4>Contexto</h4>', '').replace('<h4>Implicação prática</h4>', ''));
  assert.ok(result.errors.some((error) => error.includes('Contexto')));
  assert.ok(result.errors.some((error) => error.includes('Implicação prática')));
});
test('all references removed fails instead of 0/0 success', () =>
  assert.equal(validate(html.replaceAll(ref, '')).ok, false));
test('metadata cannot become essential analysis', () =>
  assert.ok(
    validate(
      html.replace('data-source-id="1"', 'data-source-id="2"'),
    ).errors.some((e) => e.includes('Essencial')),
  ));
test('prefix matching PMID is rejected', () =>
  assert.ok(
    validate(html.replaceAll('/123/', '/12/')).errors.some((e) =>
      e.includes('não consta'),
    ),
  ));
test('date mismatch is rejected', () =>
  assert.equal(
    validate(
      html.replace('data-edition="2026-09-13"', 'data-edition="2026-09-12"'),
    ).ok,
    false,
  ));
test('Sao Paulo date is consistent near UTC midnight', () =>
  assert.equal(editionDate(new Date('2026-09-13T01:30:00Z')), '2026-09-12'));
test('DOI and PMID come from bounded source records', () => {
  const s = materialSources(material);
  assert.equal(s.length, 2);
  assert.ok(s[0].urls.includes('doi.org/10.1000/example'));
  assert.ok(!s[0].urls.includes('pubmed.ncbi.nlm.nih.gov/456'));
});
test('missing limitation block fails', () =>
  assert.equal(validate(html.replace('<h4>Limitações</h4>', '')).ok, false));
test('invented final reference is rejected', () =>
  assert.equal(
    validate(
      html.replace(
        '<h2 class="sec">Fontes consultadas</h2><div class="fontes-finais">',
        '<h2 class="sec">Fontes consultadas</h2><div class="fontes-finais"><a href="https://example.com/invented">X</a>',
      ),
    ).ok,
    false,
  ));
test('model cannot approve its own clinical interpretation', () =>
  assert.equal(
    validate(
      html.replace(
        'MedBrain</p>',
        'MedBrain · revisão humana antes da publicação</p>',
      ),
    ).ok,
    false,
  ));
test('primary source cannot be two different news items', () => {
  const item = html.slice(
    html.indexOf('<div class="item"'),
    html.indexOf('<h2 class="sec">Outras'),
  );
  assert.ok(
    validate(
      html.replace('<h2 class="sec">Outras', item + '<h2 class="sec">Outras'),
    ).errors.some((e) => e.includes('repetida')),
  );
});
test('brief items cannot be promoted to essential', () =>
  assert.equal(
    validate(html.replace('data-kind="analysis"', 'data-kind="brief"')).ok,
    false,
  ));
