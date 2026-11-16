import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import type { AttachmentDTO } from '@reformar/shared';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { detectFileMime, newStorageKey, type StoredMime } from '../../lib/storage.js';
import type { TenantContext } from '../../plugins/auth.js';
import { requireTenant } from '../../plugins/auth.js';

export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;

type AttachmentRow = {
  id: string;
  caption: string | null;
  mime: string;
  sizeBytes: number;
  stageId: string | null;
  measurementId: string | null;
  diaryEntryId: string | null;
  expenseId: string | null;
  createdAt: Date;
  uploadedById: string | null;
};

export function attachmentToDTO(a: AttachmentRow, nameOf: (id: string | null) => string | null): AttachmentDTO {
  return {
    id: a.id,
    url: `/api/attachments/${a.id}`,
    caption: a.caption,
    mime: a.mime,
    sizeBytes: a.sizeBytes,
    stageId: a.stageId,
    measurementId: a.measurementId,
    diaryEntryId: a.diaryEntryId,
    expenseId: a.expenseId,
    createdAt: a.createdAt.toISOString(),
    uploadedByName: nameOf(a.uploadedById),
  };
}

/** Valida e grava o binário; devolve dados para criar o registro Attachment. */
export async function storeUpload(
  ctx: AppContext,
  t: TenantContext,
  body: unknown,
  allowed: StoredMime[],
  folder: 'photos' | 'receipts',
) {
  if (!Buffer.isBuffer(body) || body.length === 0) throw badRequest('Envie o arquivo (foto JPEG/PNG/WebP ou PDF).');
  const mime = detectFileMime(body);
  if (!mime || !allowed.includes(mime)) {
    throw badRequest(`Formato não aceito. Use ${allowed.map((m) => m.split('/')[1]!.toUpperCase()).join(', ')}.`);
  }
  const storageKey = newStorageKey(t.tenantId, folder, mime);
  await ctx.storage.put(storageKey, body);
  return { storageKey, mime, sizeBytes: body.length };
}

export async function attachmentRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get('/api/attachments/:id', async (request, reply) => {
    const t = requireTenant(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const a = await db.attachment.findFirst({ where: { id, tenantId: t.tenantId, deletedAt: null } });
    if (!a) throw notFound('Arquivo não encontrado.');
    // Comprovantes financeiros exigem permissão financeira; fotos da obra, acesso à obra.
    const needed = a.expenseId ? 'finance:read' : 'project:read';
    if (!t.permissions.includes(needed)) throw forbidden();
    const data = await ctx.storage.get(a.storageKey);
    return reply
      .header('Content-Type', a.mime)
      .header('Content-Disposition', 'inline')
      .header('Cache-Control', 'private, max-age=3600')
      .send(data);
  });

  app.delete('/api/attachments/:id', async (request) => {
    const t = requireTenant(request);
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const a = await db.attachment.findFirst({
      where: { id, tenantId: t.tenantId, deletedAt: null },
      include: { measurement: { select: { status: true } } },
    });
    if (!a) throw notFound('Arquivo não encontrado.');
    const canManage = a.expenseId ? t.permissions.includes('finance:write') : t.permissions.includes('project:write');
    if (!canManage && a.uploadedById !== t.userId) throw forbidden();
    if (a.measurement?.status === 'CONFIRMED') throw conflict('Fotos de medição confirmada não podem ser removidas.');
    await db.attachment.update({ where: { id }, data: { deletedAt: new Date() } });
    await ctx.storage.remove(a.storageKey);
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'attachment.deleted', entityType: 'Attachment', entityId: id, ip: t.ip });
    return { ok: true };
  });
}
