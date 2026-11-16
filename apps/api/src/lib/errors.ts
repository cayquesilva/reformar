import type { FastifyInstance } from 'fastify';
import { ZodError } from 'zod';
import { resolveLocale, translateMessage, type ApiErrorBody } from '@reformar/shared';
import { EN } from '@reformar/shared/i18n-en';

export class AppError extends Error {
  constructor(
    public readonly statusCode: number,
    public readonly code: string,
    message: string,
    public readonly fields?: Record<string, string>,
  ) {
    super(message);
  }
}

export const badRequest = (message: string, fields?: Record<string, string>) =>
  new AppError(400, 'BAD_REQUEST', message, fields);
export const unauthorized = (message = 'Faça login para continuar.') => new AppError(401, 'UNAUTHORIZED', message);
export const forbidden = (message = 'Você não tem permissão para esta ação.') => new AppError(403, 'FORBIDDEN', message);
// 404 também é usado para recursos de outra empresa: não revela que o ID existe.
export const notFound = (message = 'Não encontrado.') => new AppError(404, 'NOT_FOUND', message);
export const conflict = (message: string, code = 'CONFLICT') => new AppError(409, code, message);

export function zodFields(err: ZodError): Record<string, string> {
  const fields: Record<string, string> = {};
  for (const issue of err.issues) {
    const key = issue.path.join('.') || '_';
    if (!fields[key]) fields[key] = issue.message;
  }
  return fields;
}

export function registerErrorHandler(app: FastifyInstance) {
  app.setErrorHandler((error: unknown, request, reply) => {
    let body: ApiErrorBody;
    let status: number;
    if (error instanceof AppError) {
      status = error.statusCode;
      body = { error: error.code, message: error.message, ...(error.fields ? { fields: error.fields } : {}) };
    } else if (error instanceof ZodError) {
      status = 400;
      body = { error: 'VALIDATION', message: 'Confira os campos destacados.', fields: zodFields(error) };
    } else {
      const e = error as { statusCode?: number; code?: string; message?: string };
      if (e.statusCode === 429) {
        status = 429;
        body = { error: 'RATE_LIMIT', message: 'Muitas tentativas. Aguarde um pouco e tente de novo.' };
      } else if (e.statusCode && e.statusCode >= 400 && e.statusCode < 500) {
        status = e.statusCode;
        body = { error: e.code ?? 'BAD_REQUEST', message: 'Requisição inválida.' };
      } else {
        status = 500;
        request.log.error({ err: error }, 'erro não tratado');
        body = { error: 'INTERNAL', message: 'Algo deu errado do nosso lado. Tente de novo em instantes.' };
      }
    }
    reply.status(status).send(localize(body, request.headers['accept-language']));
  });

  app.setNotFoundHandler((request, reply) => {
    reply.status(404).send(localize({ error: 'NOT_FOUND', message: 'Endereço não encontrado.' }, request.headers['accept-language']));
  });
}

/** Mensagens de erro no idioma pedido pelo site (cabeçalho Accept-Language); o código do erro não muda. */
function localize(body: ApiErrorBody, acceptLanguage: string | undefined): ApiErrorBody {
  if (resolveLocale(acceptLanguage) !== 'en') return body;
  const fields = body.fields ? Object.fromEntries(Object.entries(body.fields).map(([k, v]) => [k, translateMessage(EN, v)])) : undefined;
  return { ...body, message: translateMessage(EN, body.message), ...(fields ? { fields } : {}) };
}
