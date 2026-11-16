/**
 * Todo texto marcado para tradução no site precisa existir no dicionário inglês.
 * Marcas reconhecidas: t('…'), tx('…'), tk('…'), tMessage('…'); rótulos em listas (label: '…', hint: '…' etc.);
 * tuplas [Ícone, '…']; e as listas STAGES, STEPS, PAYMENT_SUGGESTIONS e CTA (traduzidas ao exibir).
 */
import { readdirSync, readFileSync, statSync } from 'node:fs';
import { join } from 'node:path';
import { describe, expect, it } from 'vitest';
import { EN } from '@reformar/shared/i18n-en';

const SRC = join(__dirname, '..');
const LIT = String.raw`'((?:\\.|[^'\\\n])*)'`;
const CALL = new RegExp(String.raw`(?<![\w.])(?:t|tx|tk|tMessage)\(\s*` + LIT, 'g');
const PROP = new RegExp(
  String.raw`\b(?:label|hint|title|legend|placeholder|example|methods|unit|short|light|dark|system)\s*:\s*` + LIT,
  'g',
);
const TUPLE = new RegExp(String.raw`\[\s*[A-Za-z0-9_]+\s*,\s*` + LIT + String.raw`\s*\]`, 'g');
const CODE_LIKE = /^[A-Z0-9_]+$|^[a-z0-9_-]+$|^\/|^\s*$/;
const ACCENT = /[À-ú]/;
const unescape = (s: string) => s.replace(/\\'/g, "'").replace(/\\\\/g, '\\');

function files(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const p = join(dir, name);
    if (statSync(p).isDirectory()) return name === 'vendor' ? [] : files(p);
    return /\.tsx?$/.test(name) && !name.includes('.test.') && name !== 'i18n.tsx' ? [p] : [];
  });
}

function keysOf(source: string): string[] {
  const out: string[] = [];
  for (const m of source.matchAll(CALL)) out.push(unescape(m[1]!));
  for (const m of source.matchAll(PROP)) {
    const v = unescape(m[1]!);
    if (!CODE_LIKE.test(v) || ACCENT.test(v)) out.push(v);
  }
  for (const m of source.matchAll(TUPLE)) out.push(unescape(m[1]!));
  for (const name of ['STAGES', 'STEPS', 'PAYMENT_SUGGESTIONS', 'CTA']) {
    const block = new RegExp(String.raw`\b${name}\s*=\s*(\[[^\]]*\]|${LIT})`, 's').exec(source)?.[0];
    if (block) for (const m of block.matchAll(new RegExp(LIT, 'g'))) out.push(unescape(m[1]!));
  }
  return out.filter((k) => /[A-Za-zÀ-ú]/.test(k));
}

describe('dicionário inglês', () => {
  it('cobre todos os textos marcados no site', () => {
    const missing = new Set<string>();
    for (const f of files(SRC)) {
      for (const k of keysOf(readFileSync(f, 'utf8'))) if (!(k in EN)) missing.add(`${k}  (${f.slice(SRC.length + 1)})`);
    }
    expect([...missing]).toEqual([]);
  });
});
