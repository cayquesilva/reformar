import type { Db, Tx } from '../db.js';
import type { Prisma } from '../db.js';

export interface AuditEntry {
  tenantId: string | null;
  userId: string | null;
  action: string;
  entityType: string;
  entityId?: string | null;
  data?: Prisma.InputJsonValue;
  ip?: string | null;
}

/** Registra trilha de auditoria. Nunca incluir senhas, tokens ou documentos completos em `data`. */
export async function audit(db: Db | Tx, entry: AuditEntry): Promise<void> {
  await db.auditLog.create({
    data: {
      tenantId: entry.tenantId,
      userId: entry.userId,
      action: entry.action,
      entityType: entry.entityType,
      entityId: entry.entityId ?? null,
      data: entry.data ?? undefined,
      ip: entry.ip ?? null,
    },
  });
}
