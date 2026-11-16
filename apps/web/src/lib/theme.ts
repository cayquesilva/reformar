/**
 * Tema claro, escuro ou automático (segue o aparelho). A escolha fica salva no aparelho.
 * O atributo `data-theme` vai no <html>; um script em index.html aplica antes da primeira pintura.
 */
import { useSyncExternalStore } from 'react';

export type ThemeChoice = 'light' | 'dark' | 'system';
const KEY = 'reformar:tema';
const listeners = new Set<() => void>();
const media = typeof window !== 'undefined' ? window.matchMedia('(prefers-color-scheme: dark)') : null;

function read(): ThemeChoice {
  try {
    const v = localStorage.getItem(KEY);
    return v === 'light' || v === 'dark' ? v : 'system';
  } catch {
    return 'system';
  }
}

let choice: ThemeChoice = typeof window !== 'undefined' ? read() : 'system';

export function resolvedTheme(c: ThemeChoice = choice): 'light' | 'dark' {
  return c === 'system' ? (media?.matches ? 'dark' : 'light') : c;
}

function apply() {
  const t = resolvedTheme();
  document.documentElement.dataset.theme = t;
  document.querySelector('meta[name="theme-color"]')?.setAttribute('content', t === 'dark' ? '#0b1622' : '#f6f7f9');
}

export function setTheme(next: ThemeChoice) {
  choice = next;
  try {
    if (next === 'system') localStorage.removeItem(KEY);
    else localStorage.setItem(KEY, next);
  } catch {
    /* aparelho sem armazenamento: vale só nesta sessão */
  }
  // Troca suave quando o navegador permite; sem animação para quem prefere menos movimento.
  const doc = document as Document & { startViewTransition?: (cb: () => void) => unknown };
  const reduce = window.matchMedia('(prefers-reduced-motion: reduce)').matches;
  if (doc.startViewTransition && !reduce) doc.startViewTransition(apply);
  else apply();
  listeners.forEach((l) => l());
}

media?.addEventListener('change', () => {
  if (choice === 'system') {
    apply();
    listeners.forEach((l) => l());
  }
});

export function useTheme(): { choice: ThemeChoice; resolved: 'light' | 'dark' } {
  const c = useSyncExternalStore(
    (cb) => {
      listeners.add(cb);
      return () => listeners.delete(cb);
    },
    () => choice,
  );
  return { choice: c, resolved: resolvedTheme(c) };
}

export const THEME_LABEL: Record<ThemeChoice, string> = { light: 'Claro', dark: 'Escuro', system: 'Automático' };
