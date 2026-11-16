/**
 * Idiomas da interface. O texto em português é a própria chave (estilo gettext):
 * `translate('en', 'Novo orçamento')` procura no dicionário inglês e, se não achar, devolve o português.
 * Variáveis entram como `{nome}`: `translate('en', '{n} obra(s)', { n: 3 })`.
 *
 * O dicionário inglês fica em `@reformar/shared/i18n-en` (fora do índice), para o site baixá-lo só
 * quando o inglês for escolhido.
 */
export type Locale = 'pt-BR' | 'en';
export const LOCALES: readonly Locale[] = ['pt-BR', 'en'];
export const DEFAULT_LOCALE: Locale = 'pt-BR';
export const LOCALE_INFO: Record<Locale, { label: string; short: string; htmlLang: string }> = {
  'pt-BR': { label: 'Português', short: 'PT', htmlLang: 'pt-BR' },
  en: { label: 'English', short: 'EN', htmlLang: 'en' },
};

export type Dictionary = Readonly<Record<string, string>>;
export type Vars = Record<string, string | number | null | undefined>;

/** Lê um idioma de um valor solto (preferência salva ou cabeçalho Accept-Language). */
export function resolveLocale(input: string | null | undefined): Locale {
  if (!input) return DEFAULT_LOCALE;
  for (const part of input.split(',')) {
    const tag = part.split(';')[0]!.trim().toLowerCase();
    if (tag.startsWith('pt')) return 'pt-BR';
    if (tag.startsWith('en')) return 'en';
  }
  return DEFAULT_LOCALE;
}

export function interpolate(text: string, vars?: Vars): string {
  if (!vars) return text;
  return text.replace(/\{(\w+)\}/g, (m, k: string) => {
    const v = vars[k];
    return v === undefined || v === null ? m : String(v);
  });
}

/** Tradução de um texto-chave (com variáveis). Sem tradução, fica o português. */
export function translate(dict: Dictionary | null, key: string, vars?: Vars): string {
  return interpolate((dict && dict[key]) || key, vars);
}

type Pattern = { re: RegExp; names: string[]; en: string };
const patternCache = new WeakMap<Dictionary, Pattern[]>();

function patternsOf(dict: Dictionary): Pattern[] {
  let list = patternCache.get(dict);
  if (list) return list;
  list = [];
  for (const [pt, en] of Object.entries(dict)) {
    if (!pt.includes('{')) continue;
    const names: string[] = [];
    const src = pt
      .split(/(\{\w+\})/)
      .map((piece) => {
        const m = /^\{(\w+)\}$/.exec(piece);
        if (m) {
          names.push(m[1]!);
          return '(.+?)';
        }
        return piece.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
      })
      .join('');
    list.push({ re: new RegExp(`^${src}$`, 's'), names, en });
  }
  // Modelos mais longos (mais específicos) primeiro.
  list.sort((a, b) => b.re.source.length - a.re.source.length);
  patternCache.set(dict, list);
  return list;
}

/**
 * Tradução de uma mensagem já montada em português (ex.: erro vindo do servidor com números dentro).
 * Tenta o texto exato e depois os modelos com variáveis do dicionário.
 */
export function translateMessage(dict: Dictionary | null, message: string): string {
  if (!dict) return message;
  const exact = dict[message];
  if (exact) return exact;
  for (const p of patternsOf(dict)) {
    const m = p.re.exec(message);
    if (!m) continue;
    const vars: Vars = {};
    // Pedaços variáveis que também são textos conhecidos (ex.: unidade "diária") são traduzidos.
    p.names.forEach((n, i) => {
      const v = m[i + 1] ?? '';
      vars[n] = dict[v] ?? v;
    });
    return interpolate(p.en, vars);
  }
  return message;
}
