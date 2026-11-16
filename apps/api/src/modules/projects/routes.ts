import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  dec,
  decToString,
  diarySchema,
  measurementConfirmSchema,
  measurementSchema,
  measurementValue,
  projectCreateSchema,
  projectFromQuoteSchema,
  projectUpdateSchema,
  stageSchema,
  todayISO,
  type DiaryEntryDTO,
  type MeasurementDTO,
  type ProjectSummaryDTO,
} from '@reformar/shared';
import type { AppContext } from '../../context.js';
import type { Db, Tx } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { centsOut, dateIn, dateOut, decOut } from '../../lib/convert.js';
import { badRequest, conflict, forbidden, notFound } from '../../lib/errors.js';
import { withIdempotency } from '../../lib/idempotency.js';
import { userNames } from '../../lib/users.js';
import { requireTenant, type TenantContext } from '../../plugins/auth.js';
import { attachmentToDTO, MAX_UPLOAD_BYTES, storeUpload } from './attachments.js';
import {
  canSeeMoney,
  createProjectFromQuote,
  createStandaloneProject,
  getProjectDetail,
  loadProject,
  projectSummarySelect,
  toProjectSummary,
} from './service.js';

const idParams = z.object({ id: z.uuid() });
const subParams = z.object({ id: z.uuid(), sub: z.uuid() });

async function measurementsDTO(db: Db, t: TenantContext, projectId: string, onlyId?: string): Promise<MeasurementDTO[]> {
  const rows = await db.measurement.findMany({
    where: { tenantId: t.tenantId, projectId, ...(onlyId ? { id: onlyId } : {}) },
    orderBy: { number: 'desc' },
    include: {
      items: { include: { stage: { select: { name: true, unit: true, position: true } } } },
      attachments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } },
      receivable: { select: { id: true } },
    },
  });
  const nameOf = await userNames(db, t.tenantId, rows.flatMap((m) => [m.createdById, m.confirmedById, ...m.attachments.map((a) => a.uploadedById)]));
  const money = canSeeMoney(t);
  return rows.map((m) => ({
    id: m.id,
    number: m.number,
    measuredOn: dateOut(m.measuredOn),
    notes: m.notes,
    status: m.status,
    totalCents: money ? centsOut(m.totalCents) : null,
    items: m.items
      .sort((a, b) => a.stage.position - b.stage.position)
      .map((i) => ({
        stageId: i.stageId,
        stageName: i.stage.name,
        unit: i.stage.unit,
        quantity: decOut(i.quantity),
        valueCents: money ? centsOut(i.valueCents) : null,
        notes: i.notes,
      })),
    photos: m.attachments.map((a) => attachmentToDTO(a, nameOf)),
    createdByName: nameOf(m.createdById),
    confirmedByName: nameOf(m.confirmedById),
    confirmedAt: m.confirmedAt?.toISOString() ?? null,
    receivableId: m.receivable?.id ?? null,
  }));
}

async function assertStagesOfProject(db: Db | Tx, tenantId: string, projectId: string, stageIds: string[]) {
  if (!stageIds.length) return [];
  const stages = await db.projectStage.findMany({ where: { tenantId, projectId, id: { in: stageIds } } });
  if (stages.length !== new Set(stageIds).size) throw badRequest('Etapa não pertence a esta obra.');
  return stages;
}

export async function projectRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  // ---------- Obras ----------
  app.get('/api/projects', async (request): Promise<ProjectSummaryDTO[]> => {
    const t = requireTenant(request, 'project:read');
    const q = z
      .object({ status: z.enum(['PLANNED', 'IN_PROGRESS', 'PAUSED', 'COMPLETED', 'CANCELED', 'ACTIVE']).optional(), q: z.string().trim().max(100).optional() })
      .parse(request.query);
    const rows = await db.project.findMany({
      where: {
        tenantId: t.tenantId,
        ...(q.status === 'ACTIVE' ? { status: { in: ['PLANNED', 'IN_PROGRESS', 'PAUSED'] } } : q.status ? { status: q.status } : {}),
        ...(q.q
          ? { OR: [{ name: { contains: q.q, mode: 'insensitive' } }, { customer: { name: { contains: q.q, mode: 'insensitive' } } }] }
          : {}),
      },
      select: projectSummarySelect,
      orderBy: { updatedAt: 'desc' },
      take: 100,
    });
    return rows.map((r) => toProjectSummary(r, t));
  });

  app.post('/api/projects/from-quote', async (request, reply) => {
    const t = requireTenant(request, 'project:write');
    const input = projectFromQuoteSchema.parse(request.body);
    const result = await withIdempotency(db, request, t, `project.fromQuote:${input.quoteId}`, async () => ({
      status: 201,
      body: await createProjectFromQuote(db, t, input),
    }));
    return reply.status(result.status).send(result.body);
  });

  app.post('/api/projects', async (request, reply) => {
    const t = requireTenant(request, 'project:write');
    const input = projectCreateSchema.parse(request.body);
    return reply.status(201).send(await createStandaloneProject(db, t, input));
  });

  app.get('/api/projects/:id', async (request) => {
    const t = requireTenant(request, 'project:read');
    const { id } = idParams.parse(request.params);
    return getProjectDetail(db, t, id);
  });

  app.put('/api/projects/:id', async (request) => {
    const t = requireTenant(request, 'project:write');
    const { id } = idParams.parse(request.params);
    const input = projectUpdateSchema.parse(request.body);
    const p = await loadProject(db, t.tenantId, id);
    await db.project.update({
      where: { id, tenantId: t.tenantId },
      data: {
        ...input,
        startDate: input.startDate ? dateIn(input.startDate) : null,
        expectedEndDate: input.expectedEndDate ? dateIn(input.expectedEndDate) : null,
        completedAt: input.status === 'COMPLETED' ? (p.completedAt ?? new Date()) : null,
      },
    });
    await audit(db, {
      tenantId: t.tenantId,
      userId: t.userId,
      action: 'project.updated',
      entityType: 'Project',
      entityId: id,
      data: { statusBefore: p.status, statusAfter: input.status },
      ip: t.ip,
    });
    return getProjectDetail(db, t, id);
  });

  // ---------- Etapas ----------
  app.post('/api/projects/:id/stages', async (request, reply) => {
    const t = requireTenant(request, 'project:write');
    const { id } = idParams.parse(request.params);
    const input = stageSchema.parse(request.body);
    await loadProject(db, t.tenantId, id);
    const position = await db.projectStage.count({ where: { tenantId: t.tenantId, projectId: id } });
    const s = await db.projectStage.create({
      data: { ...input, unitPriceCents: BigInt(input.unitPriceCents), tenantId: t.tenantId, projectId: id, position },
    });
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'stage.created', entityType: 'Project', entityId: id, data: { stage: s.name }, ip: t.ip });
    return reply.status(201).send({ id: s.id });
  });

  app.put('/api/projects/:id/stages/:sub', async (request) => {
    const t = requireTenant(request, 'project:write');
    const { id, sub } = subParams.parse(request.params);
    const input = stageSchema.parse(request.body);
    const stage = await db.projectStage.findFirst({ where: { id: sub, projectId: id, tenantId: t.tenantId } });
    if (!stage) throw notFound('Etapa não encontrada.');
    if (dec(input.plannedQuantity).lessThan(decOut(stage.measuredQuantity))) {
      throw badRequest('A quantidade prevista não pode ser menor que a já medida.', {
        plannedQuantity: `Já foram medidos ${decOut(stage.measuredQuantity)}.`,
      });
    }
    await db.projectStage.update({
      where: { id: sub, tenantId: t.tenantId },
      data: { ...input, unitPriceCents: BigInt(input.unitPriceCents) },
    });
    await audit(db, {
      tenantId: t.tenantId,
      userId: t.userId,
      action: 'stage.updated',
      entityType: 'Project',
      entityId: id,
      data: {
        stage: stage.name,
        plannedBefore: decOut(stage.plannedQuantity),
        plannedAfter: input.plannedQuantity,
        priceBefore: centsOut(stage.unitPriceCents),
        priceAfter: input.unitPriceCents,
      },
      ip: t.ip,
    });
    return { ok: true };
  });

  app.delete('/api/projects/:id/stages/:sub', async (request) => {
    const t = requireTenant(request, 'project:write');
    const { id, sub } = subParams.parse(request.params);
    const stage = await db.projectStage.findFirst({
      where: { id: sub, projectId: id, tenantId: t.tenantId },
      include: { _count: { select: { measurementItems: true } } },
    });
    if (!stage) throw notFound('Etapa não encontrada.');
    if (stage._count.measurementItems > 0) throw conflict('Etapa com medições não pode ser excluída.');
    await db.projectStage.delete({ where: { id: sub } });
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'stage.deleted', entityType: 'Project', entityId: id, data: { stage: stage.name }, ip: t.ip });
    return { ok: true };
  });

  // ---------- Medições ----------
  app.get('/api/projects/:id/measurements', async (request) => {
    const t = requireTenant(request, 'project:read');
    const { id } = idParams.parse(request.params);
    await loadProject(db, t.tenantId, id);
    return measurementsDTO(db, t, id);
  });

  app.post('/api/projects/:id/measurements', async (request, reply) => {
    const t = requireTenant(request, 'project:field');
    const { id } = idParams.parse(request.params);
    const input = measurementSchema.parse(request.body);
    const result = await withIdempotency(db, request, t, `measurement.create:${id}`, async () => {
      const created = await db.$transaction(async (tx) => {
        const project = await loadProject(tx, t.tenantId, id);
        if (project.status === 'CANCELED' || project.status === 'COMPLETED') throw conflict('Obra encerrada não recebe medições.');
        await assertStagesOfProject(tx, t.tenantId, id, input.items.map((i) => i.stageId));
        const last = await tx.measurement.findFirst({ where: { tenantId: t.tenantId, projectId: id }, orderBy: { number: 'desc' }, select: { number: true } });
        const m = await tx.measurement.create({
          data: {
            tenantId: t.tenantId,
            projectId: id,
            number: (last?.number ?? 0) + 1,
            measuredOn: dateIn(input.measuredOn),
            notes: input.notes,
            createdById: t.userId,
          },
        });
        if (input.items.length) {
          await tx.measurementItem.createMany({
            data: input.items.map((i) => ({ tenantId: t.tenantId, measurementId: m.id, stageId: i.stageId, quantity: i.quantity, notes: i.notes })),
          });
        }
        await audit(tx, { tenantId: t.tenantId, userId: t.userId, action: 'measurement.created', entityType: 'Project', entityId: id, data: { number: m.number }, ip: t.ip });
        return { id: m.id, number: m.number };
      });
      return { status: 201, body: created };
    });
    return reply.status(result.status).send(result.body);
  });

  app.put('/api/projects/:id/measurements/:sub', async (request) => {
    const t = requireTenant(request, 'project:field');
    const { id, sub } = subParams.parse(request.params);
    const input = measurementSchema.parse(request.body);
    await db.$transaction(async (tx) => {
      const m = await tx.measurement.findFirst({ where: { id: sub, projectId: id, tenantId: t.tenantId } });
      if (!m) throw notFound('Medição não encontrada.');
      if (m.status !== 'DRAFT') throw conflict('Medição confirmada não pode ser alterada.', 'LOCKED');
      await assertStagesOfProject(tx, t.tenantId, id, input.items.map((i) => i.stageId));
      await tx.measurement.update({ where: { id: sub }, data: { measuredOn: dateIn(input.measuredOn), notes: input.notes } });
      await tx.measurementItem.deleteMany({ where: { tenantId: t.tenantId, measurementId: sub } });
      if (input.items.length) {
        await tx.measurementItem.createMany({
          data: input.items.map((i) => ({ tenantId: t.tenantId, measurementId: sub, stageId: i.stageId, quantity: i.quantity, notes: i.notes })),
        });
      }
    });
    return (await measurementsDTO(db, t, id, sub))[0];
  });

  app.delete('/api/projects/:id/measurements/:sub', async (request) => {
    const t = requireTenant(request, 'project:field');
    const { id, sub } = subParams.parse(request.params);
    const m = await db.measurement.findFirst({ where: { id: sub, projectId: id, tenantId: t.tenantId }, include: { attachments: true } });
    if (!m) throw notFound('Medição não encontrada.');
    if (m.status !== 'DRAFT') throw conflict('Medição confirmada não pode ser excluída.', 'LOCKED');
    await db.measurement.delete({ where: { id: sub } });
    for (const a of m.attachments) await ctx.storage.remove(a.storageKey);
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'measurement.deleted', entityType: 'Project', entityId: id, data: { number: m.number }, ip: t.ip });
    return { ok: true };
  });

  /**
   * Confirma a medição: soma as quantidades nas etapas (sem ultrapassar o previsto),
   * fixa os valores e, se pedido, gera a cobrança (conta a receber) com valor conferido.
   */
  app.post('/api/projects/:id/measurements/:sub/confirm', async (request) => {
    const t = requireTenant(request, 'measurement:confirm');
    const { id, sub } = subParams.parse(request.params);
    const { receivable } = measurementConfirmSchema.parse(request.body ?? {});
    if (receivable && !t.permissions.includes('finance:write')) throw forbidden('Você não tem permissão para gerar cobranças.');
    await db.$transaction(async (tx) => {
      const project = await loadProject(tx, t.tenantId, id);
      const m = await tx.measurement.findFirst({
        where: { id: sub, projectId: id, tenantId: t.tenantId },
        include: { items: { include: { stage: true } } },
      });
      if (!m) throw notFound('Medição não encontrada.');
      // Guarda contra confirmação dupla (duplo toque / duas abas).
      const lock = await tx.measurement.updateMany({
        where: { id: sub, tenantId: t.tenantId, status: 'DRAFT' },
        data: { status: 'CONFIRMED', confirmedById: t.userId, confirmedAt: new Date() },
      });
      if (lock.count === 0) throw conflict('Esta medição já foi confirmada.', 'LOCKED');
      if (m.items.length === 0) throw badRequest('Informe ao menos uma etapa com quantidade executada.');

      let total = 0;
      for (const item of m.items) {
        const qty = decOut(item.quantity);
        // Atualização condicional atômica: nunca ultrapassa a quantidade prevista.
        const updated = await tx.$executeRaw`
          UPDATE "ProjectStage"
             SET "measuredQuantity" = "measuredQuantity" + ${qty}::numeric,
                 "status" = CASE WHEN "measuredQuantity" + ${qty}::numeric >= "plannedQuantity" THEN 'DONE'::"StageStatus" ELSE 'IN_PROGRESS'::"StageStatus" END,
                 "updatedAt" = now()
           WHERE "id" = ${item.stageId}::uuid AND "tenantId" = ${t.tenantId}::uuid
             AND "measuredQuantity" + ${qty}::numeric <= "plannedQuantity"`;
        if (updated === 0) {
          const remaining = decToString(dec(decOut(item.stage.plannedQuantity)).minus(decOut(item.stage.measuredQuantity)));
          throw badRequest(
            `"${item.stage.name}": a medição passa do previsto. Falta medir ${remaining}. Se o serviço aumentou, ajuste a quantidade prevista da etapa (aditivo).`,
            { [`items.${item.stageId}`]: `Máximo ${remaining}` },
          );
        }
        const value = measurementValue(qty, centsOut(item.stage.unitPriceCents));
        total += value;
        await tx.measurementItem.update({ where: { id: item.id }, data: { valueCents: BigInt(value) } });
      }
      await tx.measurement.update({ where: { id: sub }, data: { totalCents: BigInt(total) } });
      if (project.status === 'PLANNED') {
        await tx.project.update({ where: { id }, data: { status: 'IN_PROGRESS', startDate: project.startDate ?? m.measuredOn } });
      }
      if (receivable) {
        await tx.receivable.create({
          data: {
            tenantId: t.tenantId,
            projectId: id,
            customerId: project.customerId,
            measurementId: sub,
            kind: 'MEASUREMENT',
            description: `Medição nº ${m.number} - ${project.name}`.slice(0, 200),
            amountCents: BigInt(receivable.amountCents),
            dueDate: dateIn(receivable.dueDate),
            createdById: t.userId,
          },
        });
      }
      await audit(tx, {
        tenantId: t.tenantId,
        userId: t.userId,
        action: 'measurement.confirmed',
        entityType: 'Project',
        entityId: id,
        data: { number: m.number, totalCents: total, receivableCents: receivable?.amountCents ?? null },
        ip: t.ip,
      });
    });
    return (await measurementsDTO(db, t, id, sub))[0];
  });

  // ---------- Diário ----------
  app.get('/api/projects/:id/diary', async (request): Promise<DiaryEntryDTO[]> => {
    const t = requireTenant(request, 'project:read');
    const { id } = idParams.parse(request.params);
    await loadProject(db, t.tenantId, id);
    const rows = await db.diaryEntry.findMany({
      where: { tenantId: t.tenantId, projectId: id },
      orderBy: [{ date: 'desc' }, { createdAt: 'desc' }],
      take: 100,
      include: { attachments: { where: { deletedAt: null }, orderBy: { createdAt: 'asc' } } },
    });
    const nameOf = await userNames(db, t.tenantId, rows.flatMap((r) => [r.createdById, ...r.attachments.map((a) => a.uploadedById)]));
    return rows.map((r) => ({
      id: r.id,
      date: dateOut(r.date),
      text: r.text,
      weather: r.weather,
      workersCount: r.workersCount,
      photos: r.attachments.map((a) => attachmentToDTO(a, nameOf)),
      createdByName: nameOf(r.createdById),
      createdAt: r.createdAt.toISOString(),
    }));
  });

  app.post('/api/projects/:id/diary', async (request, reply) => {
    const t = requireTenant(request, 'project:field');
    const { id } = idParams.parse(request.params);
    const input = diarySchema.parse(request.body);
    await loadProject(db, t.tenantId, id);
    if (input.date > todayISO()) throw badRequest('A data do diário não pode ser no futuro.', { date: 'Use hoje ou uma data anterior.' });
    const e = await db.diaryEntry.create({
      data: { ...input, date: dateIn(input.date), tenantId: t.tenantId, projectId: id, createdById: t.userId },
    });
    return reply.status(201).send({ id: e.id });
  });

  app.delete('/api/projects/:id/diary/:sub', async (request) => {
    const t = requireTenant(request, 'project:field');
    const { id, sub } = subParams.parse(request.params);
    const e = await db.diaryEntry.findFirst({ where: { id: sub, projectId: id, tenantId: t.tenantId }, include: { attachments: true } });
    if (!e) throw notFound('Registro não encontrado.');
    if (e.createdById !== t.userId && !t.permissions.includes('project:write')) throw forbidden();
    await db.diaryEntry.delete({ where: { id: sub } });
    for (const a of e.attachments) await ctx.storage.remove(a.storageKey);
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'diary.deleted', entityType: 'Project', entityId: id, ip: t.ip });
    return { ok: true };
  });

  // ---------- Fotos ----------
  app.get('/api/projects/:id/photos', async (request) => {
    const t = requireTenant(request, 'project:read');
    const { id } = idParams.parse(request.params);
    const q = z.object({ stageId: z.uuid().optional() }).parse(request.query);
    await loadProject(db, t.tenantId, id);
    const rows = await db.attachment.findMany({
      where: { tenantId: t.tenantId, projectId: id, kind: 'PHOTO', deletedAt: null, ...(q.stageId ? { stageId: q.stageId } : {}) },
      orderBy: { createdAt: 'desc' },
      take: 200,
    });
    const nameOf = await userNames(db, t.tenantId, rows.map((r) => r.uploadedById));
    return rows.map((r) => attachmentToDTO(r, nameOf));
  });

  app.post('/api/projects/:id/photos', { bodyLimit: MAX_UPLOAD_BYTES }, async (request, reply) => {
    const t = requireTenant(request, 'project:field');
    const { id } = idParams.parse(request.params);
    const q = z
      .object({
        caption: z.string().trim().max(300).optional(),
        stageId: z.uuid().optional(),
        measurementId: z.uuid().optional(),
        diaryEntryId: z.uuid().optional(),
      })
      .parse(request.query);
    await loadProject(db, t.tenantId, id);
    if (q.stageId) await assertStagesOfProject(db, t.tenantId, id, [q.stageId]);
    if (q.measurementId) {
      const m = await db.measurement.findFirst({ where: { id: q.measurementId, projectId: id, tenantId: t.tenantId } });
      if (!m) throw notFound('Medição não encontrada.');
      if (m.status === 'CONFIRMED') throw conflict('Medição confirmada não recebe novas fotos. Use o diário da obra.', 'LOCKED');
    }
    if (q.diaryEntryId) {
      const d = await db.diaryEntry.findFirst({ where: { id: q.diaryEntryId, projectId: id, tenantId: t.tenantId } });
      if (!d) throw notFound('Registro do diário não encontrado.');
    }
    const file = await storeUpload(ctx, t, request.body, ['image/jpeg', 'image/png', 'image/webp'], 'photos');
    const a = await db.attachment.create({
      data: {
        tenantId: t.tenantId,
        kind: 'PHOTO',
        projectId: id,
        stageId: q.stageId ?? null,
        measurementId: q.measurementId ?? null,
        diaryEntryId: q.diaryEntryId ?? null,
        caption: q.caption || null,
        uploadedById: t.userId,
        ...file,
      },
    });
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'photo.uploaded', entityType: 'Project', entityId: id, data: { attachmentId: a.id, bytes: file.sizeBytes }, ip: t.ip });
    return reply.status(201).send(attachmentToDTO(a, () => null));
  });

  // Materiais previstos: vincular ao cadastro de materiais (para acompanhar comprado × usado).
  app.put('/api/projects/:id/materials/:sub', async (request) => {
    const t = requireTenant(request, 'project:write');
    const { id, sub } = subParams.parse(request.params);
    const { materialId } = z.object({ materialId: z.uuid().nullable() }).parse(request.body);
    const pm = await db.projectMaterial.findFirst({ where: { id: sub, projectId: id, tenantId: t.tenantId } });
    if (!pm) throw notFound('Material previsto não encontrado.');
    if (materialId) {
      const m = await db.material.findFirst({ where: { id: materialId, tenantId: t.tenantId } });
      if (!m) throw notFound('Material não encontrado.');
    }
    await db.projectMaterial.update({ where: { id: sub }, data: { materialId } });
    return { ok: true };
  });
}

