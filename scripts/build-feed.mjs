#!/usr/bin/env node
/**
 * Gera o feed.json a partir dos boletins .html de uma pasta (Fase 2 — ver docs/feed.md).
 *
 * Uso:  node scripts/build-feed.mjs <pasta-dos-boletins>
 *
 * O manifesto é escrito na própria pasta; depois basta subir os arquivos
 * (.html + feed.json) no repositório público do feed.
 */
import { readdirSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';

const dir = resolve(process.argv[2] ?? '.');
const files = readdirSync(dir)
  .filter((f) => /\.x?html?$/i.test(f))
  .sort();

const manifest = { version: 1, updatedAt: new Date().toISOString(), files };
writeFileSync(join(dir, 'feed.json'), JSON.stringify(manifest, null, 2) + '\n');
console.log(`feed.json gerado com ${files.length} boletim(ns) em ${dir}`);
