import type { FastifyRequest } from 'fastify';
import type { Db, Prisma } from '../db.js';
import { Prisma as P } from '../db.js';
import type { TenantContext } from '../plugins/auth.js';
import { badRequest, conflict } from './errors.js';

/**
 * Executa `handler` no máximo uma vez por chave (cabeçalho Idempotency-Key).
 * Reenvios com a mesma chave recebem a mesma resposta, sem gravar de novo.
 * Sem cabeçalho, executa normalmente.
 */
export async function withIdempotency<T extends Prisma.InputJsonValue>(
  db: Db,
  request: FastifyRequest,
  t: TenantContext,
  route: string,
  handler: () => Promise<{ status: number; body: T }>,
): Promise<{ status: number; body: T; replayed: boolean }> {
  const raw = request.headers['idempotency-key'];
  if (raw === undefined) return { ...(await handler()), replayed: false };
  const key = Array.isArray(raw) ? raw[0] : raw;
  if (!key || key.length < 8 || key.length > 100 || !/^[\w-]+$/.test(key)) {
    throw badRequest('Idempotency-Key inválida.');
  }

  try {
    await db.idempotencyKey.create({ data: { tenantId: t.tenantId, userId: t.userId, key, route } });
  } catch (e) {
    if (!(e instanceof P.PrismaClientKnownRequestError && e.code === 'P2002')) throw e;
    const existing = await db.idempotencyKey.findUnique({
      where: { tenantId_userId_key: { tenantId: t.tenantId, userId: t.userId, key } },
    });
    if (!existing || existing.route !== route) throw conflict('Chave de idempotência já usada em outra operação.');
    if (!existing.completed) throw conflict('Esta operação ainda está sendo processada. Aguarde.', 'IN_PROGRESS');
    return { status: existing.responseStatus ?? 200, body: existing.responseBody as T, replayed: true };
  }

  try {
    const result = await handler();
    await db.idempotencyKey.update({
      where: { tenantId_userId_key: { tenantId: t.tenantId, userId: t.userId, key } },
      data: { completed: true, responseStatus: result.status, responseBody: result.body },
    });
    return { ...result, replayed: false };
  } catch (e) {
    // Falhou: libera a chave para nova tentativa.
    await db.idempotencyKey.delete({
      where: { tenantId_userId_key: { tenantId: t.tenantId, userId: t.userId, key } },
    });
    throw e;
  }
}
