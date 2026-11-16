import { Fragment, useSyncExternalStore, type ReactNode } from 'react';
import {
  formatDateBR,
  LOCALE_INFO,
  resolveLocale,
  translate,
  translateMessage,
  type Dictionary,
  type Locale,
  type Vars,
} from '@reformar/shared';

/**
 * Idioma da interface (português ou inglês). O texto em português é a chave: `t('Novo orçamento')`.
 * O dicionário inglês só é baixado quando o inglês é escolhido. Trocar de idioma remonta a árvore
 * (ver <I18nRoot>), então `t()` pode ser chamado direto na renderização, sem hook.
 */
const KEY = 'reformar:idioma';

function initialLocale(): Locale {
  try {
    const saved = localStorage.getItem(KEY);
    if (saved === 'pt-BR' || saved === 'en') return saved;
  } catch {
    // armazenamento bloqueado: segue o navegador
  }
  return resolveLocale(typeof navigator !== 'undefined' ? navigator.languages?.join(',') || navigator.language : null);
}

let locale: Locale = initialLocale();
let dict: Dictionary | null = null;
const listeners = new Set<() => void>();

async function loadDictionary(l: Locale) {
  if (l === 'en' && !dict) dict = (await import('@reformar/shared/i18n-en')).EN;
}

function applyDocument() {
  if (typeof document === 'undefined') return;
  document.documentElement.lang = LOCALE_INFO[locale].htmlLang;
}

/** Carrega o dicionário do idioma atual antes da primeira pintura (chamado em main.tsx). */
export async function initI18n() {
  try {
    await loadDictionary(locale);
  } catch {
    locale = 'pt-BR'; // sem o arquivo (ex.: offline na primeira visita): fica em português
  }
  applyDocument();
}

export function getLocale(): Locale {
  return locale;
}

export async function setLocale(next: Locale) {
  if (next === locale) return;
  await loadDictionary(next);
  locale = next;
  try {
    localStorage.setItem(KEY, next);
  } catch {
    // sem armazenamento: vale só nesta visita
  }
  applyDocument();
  listeners.forEach((l) => l());
}

/** Marca um texto para tradução sem traduzir agora (listas fora de componentes; traduza com t() ao exibir). */
export const tk = <T extends string>(text: T): T => text;

/** Texto da interface no idioma atual. */
export function t(key: string, vars?: Vars): string {
  return translate(locale === 'en' ? dict : null, key, vars);
}

/** Mensagem já montada em português (com números dentro) traduzida pelos modelos do dicionário. */
export function tMessage(message: string): string {
  return locale === 'en' ? translateMessage(dict, message) : message;
}

export function useLocale(): Locale {
  return useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => locale,
    () => locale,
  );
}

/** Remonta a interface quando o idioma muda (os dados em cache do TanStack Query continuam). */
export function I18nRoot({ children }: { children: ReactNode }) {
  const l = useLocale();
  return <Fragment key={l}>{children}</Fragment>;
}

/** Data AAAA-MM-DD no formato do idioma (pt: 13/11/2026 · en: Nov 13, 2026). Valores em reais seguem em R$. */
export function fmtDate(iso: string): string {
  if (locale !== 'en') return formatDateBR(iso);
  const [y, m, d] = iso.slice(0, 10).split('-').map(Number) as [number, number, number];
  return new Intl.DateTimeFormat('en-US', { dateStyle: 'medium', timeZone: 'UTC' }).format(Date.UTC(y, m - 1, d));
}

/** Dia de um instante (data-hora ISO ou Date) no fuso do aparelho. */
export function fmtDay(value: string | Date): string {
  return new Date(value).toLocaleDateString(locale === 'en' ? 'en-US' : 'pt-BR', locale === 'en' ? { dateStyle: 'medium' } : undefined);
}

/** Data e hora de um instante no fuso do aparelho. */
export function fmtDateTime(value: string | Date): string {
  return new Date(value).toLocaleString(
    locale === 'en' ? 'en-US' : 'pt-BR',
    locale === 'en' ? { dateStyle: 'medium', timeStyle: 'short' } : undefined,
  );
}

/** Código do idioma para Intl/toLocale* (nomes de mês, números de eixo etc.). */
export function intlLocale(): string {
  return locale === 'en' ? 'en-US' : 'pt-BR';
}

/**
 * Frase com elementos no meio (negrito, link): a frase inteira é traduzida e cada {nome} é
 * trocado pelo elemento correspondente, então a ordem das palavras segue o idioma.
 * Ex.: tx('Toque em {botao} para começar.', { botao: <strong>Novo</strong> })
 */
export function tx(key: string, parts: Record<string, ReactNode>): ReactNode {
  const text = locale === 'en' ? (dict?.[key] ?? key) : key;
  return text.split(/(\{\w+\})/).map((piece, i) => {
    const m = /^\{(\w+)\}$/.exec(piece);
    return m && m[1]! in parts ? <Fragment key={i}>{parts[m[1]!]}</Fragment> : piece;
  });
}
