import type { ApiErrorBody } from '@reformar/shared';
import { getLocale, t } from './i18n';

export class ApiError extends Error {
  constructor(
    public readonly status: number,
    public readonly code: string,
    message: string,
    public readonly fields: Record<string, string> = {},
  ) {
    super(message);
  }
}

interface RequestOptions {
  method?: 'GET' | 'POST' | 'PUT' | 'DELETE';
  body?: unknown;
  headers?: Record<string, string>;
  /** Corpo binário (ex.: imagem) enviado sem conversão para JSON. */
  rawBody?: Blob;
}

export async function api<T>(path: string, opts: RequestOptions = {}): Promise<T> {
  const method = opts.method ?? (opts.body !== undefined || opts.rawBody ? 'POST' : 'GET');
  // O servidor responde as mensagens no idioma escolhido aqui (não no do navegador).
  const headers: Record<string, string> = { 'X-Reformar-Client': 'web', 'Accept-Language': getLocale(), ...opts.headers };
  let body: BodyInit | undefined;
  if (opts.rawBody) {
    body = opts.rawBody;
  } else if (opts.body !== undefined) {
    headers['Content-Type'] = 'application/json';
    body = JSON.stringify(opts.body);
  }

  let res: Response;
  try {
    res = await fetch(path, { method, headers, body, credentials: 'same-origin' });
  } catch {
    throw new ApiError(0, 'NETWORK', t('Sem conexão com o servidor. Confira sua internet e tente de novo.'));
  }

  if (!res.ok) {
    let data: Partial<ApiErrorBody> = {};
    try {
      data = (await res.json()) as ApiErrorBody;
    } catch {
      /* resposta sem JSON */
    }
    throw new ApiError(res.status, data.error ?? 'HTTP', data.message ?? t('Não foi possível concluir. Tente de novo.'), data.fields);
  }
  if (res.status === 204) return undefined as T;
  return (await res.json()) as T;
}

export function errorMessage(err: unknown): string {
  if (err instanceof ApiError) return err.message;
  return t('Algo deu errado. Tente de novo.');
}
