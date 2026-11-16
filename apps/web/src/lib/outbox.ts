/**
 * Fila de envio offline (sincronização segura).
 * Cada item guarda o corpo e a MESMA Idempotency-Key para todas as tentativas: se o envio
 * chegar ao servidor mas a resposta se perder, o reenvio não grava em dobro.
 * Guardado só no aparelho (localStorage) e apenas para operações simples (ex.: registrar gasto).
 */
import { useSyncExternalStore } from 'react';
import { api, ApiError } from './api';

export interface OutboxItem {
  id: string;
  url: string;
  body: unknown;
  idempotencyKey: string;
  label: string;
  createdAt: string;
  lastError: string | null;
}

const KEY = 'reformar:fila-offline';
const listeners = new Set<() => void>();
let cache: OutboxItem[] | null = null;

function read(): OutboxItem[] {
  if (cache) return cache;
  try {
    cache = JSON.parse(localStorage.getItem(KEY) ?? '[]') as OutboxItem[];
  } catch {
    cache = [];
  }
  return cache;
}
function write(items: OutboxItem[]) {
  cache = items;
  localStorage.setItem(KEY, JSON.stringify(items));
  listeners.forEach((l) => l());
}

export function enqueue(item: Omit<OutboxItem, 'createdAt' | 'lastError'>) {
  write([...read(), { ...item, createdAt: new Date().toISOString(), lastError: null }]);
}

export function isNetworkError(e: unknown) {
  return e instanceof ApiError && e.code === 'NETWORK';
}

let flushing = false;
/** Envia os pendentes em ordem. Erros de validação ficam visíveis para o usuário corrigir/descartar. */
export async function flushOutbox(): Promise<number> {
  if (flushing || !navigator.onLine) return 0;
  flushing = true;
  let sent = 0;
  try {
    for (const item of [...read()]) {
      try {
        await api(item.url, { method: 'POST', body: item.body, headers: { 'Idempotency-Key': item.idempotencyKey } });
        write(read().filter((x) => x.id !== item.id));
        sent++;
      } catch (e) {
        if (isNetworkError(e)) break;
        write(read().map((x) => (x.id === item.id ? { ...x, lastError: (e as Error).message } : x)));
      }
    }
  } finally {
    flushing = false;
  }
  return sent;
}

export function discard(id: string) {
  write(read().filter((x) => x.id !== id));
}

export function useOutbox(): OutboxItem[] {
  return useSyncExternalStore(
    (l) => {
      listeners.add(l);
      return () => listeners.delete(l);
    },
    read,
    read,
  );
}
