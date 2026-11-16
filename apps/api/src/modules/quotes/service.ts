import {
  addDaysISO,
  calculateQuote,
  formatBRL,
  formatDateBR,
  quoteNumberLabel,
  todayISO,
  whatsappNumber,
  type QuoteContentInput,
  type QuoteDetailDTO,
  type QuoteShareDTO,
  quoteApproveSchema,
} from '@reformar/shared';
import type { z } from 'zod';
import type { AppContext } from '../../context.js';
import { Prisma, type Db, type Tx } from '../../db.js';
import { audit } from '../../lib/audit.js';
import { centsOut, dateIn, dateOut } from '../../lib/convert.js';
import { generateToken, sha256 } from '../../lib/crypto.js';
import { badRequest, conflict, notFound } from '../../lib/errors.js';
import type { TenantContext } from '../../plugins/auth.js';
import { buildQuoteDocument, type CompanyForDoc, type QuoteDocument } from './document.js';
import {
  contentToChildRows,
  contentToQuoteFields,
  quoteFullInclude,
  rowsToContent,
  toQuoteSummary,
  type QuoteFullRow,
} from './mapper.js';

const STALE_MESSAGE = 'Este orçamento foi alterado em outro aparelho ou aba. Recarregue a página para ver a versão atual.';

export async function loadQuote(db: Db | Tx, tenantId: string, id: string): Promise<QuoteFullRow> {
  const q = await db.quote.findFirst({ where: { id, tenantId, deletedAt: null }, include: quoteFullInclude });
  if (!q) throw notFound('Orçamento não encontrado.');
  return q;
}

export async function loadCompanyForDoc(db: Db | Tx, tenantId: string): Promise<CompanyForDoc> {
  const p = await db.companyProfile.findUniqueOrThrow({ where: { tenantId } });
  return {
    tradeName: p.tradeName,
    legalName: p.legalName,
    document: p.document,
    phone: p.phone,
    whatsapp: p.whatsapp,
    email: p.email,
    addressLine: p.addressLine,
    city: p.city,
    state: p.state,
    zipCode: p.zipCode,
    primaryColor: p.primaryColor,
    pdfFooter: p.pdfFooter,
  };
}

async function assertCustomer(tx: Tx, tenantId: string, customerId: string) {
  const c = await tx.customer.findFirst({ where: { id: customerId, tenantId, deletedAt: null }, select: { id: true } });
  if (!c) throw badRequest('Cliente não encontrado.', { customerId: 'Escolha um cliente válido.' });
}

async function writeChildren(tx: Tx, tenantId: string, quoteId: string, content: QuoteContentInput) {
  const rows = contentToChildRows(tenantId, quoteId, content);
  if (rows.items.length) await tx.quoteItem.createMany({ data: rows.items });
  if (rows.materials.length) await tx.quoteMaterial.createMany({ data: rows.materials });
  if (rows.costs.length) await tx.quoteCost.createMany({ data: rows.costs });
}

export async function createQuote(db: Db, t: TenantContext, content: QuoteContentInput, extraAudit?: Record<string, string | number>) {
  return db.$transaction(async (tx) => {
    await assertCustomer(tx, t.tenantId, content.customerId);
    // Numeração sequencial por empresa, atômica (UPDATE ... RETURNING).
    const { quoteSeq } = await tx.tenant.update({
      where: { id: t.tenantId },
      data: { quoteSeq: { increment: 1 } },
      select: { quoteSeq: true },
    });
    const calc = calculateQuote(content);
    const quote = await tx.quote.create({
      data: {
        ...contentToQuoteFields(content),
        tenantId: t.tenantId,
        number: quoteSeq,
        totalCents: BigInt(calc.totals.totalCents),
        createdById: t.userId,
      },
    });
    await writeChildren(tx, t.tenantId, quote.id, content);
    await audit(tx, {
      tenantId: t.tenantId,
      userId: t.userId,
      action: 'quote.created',
      entityType: 'Quote',
      entityId: quote.id,
      data: { number: quoteSeq, totalCents: calc.totals.totalCents, ...extraAudit },
      ip: t.ip,
    });
    return { id: quote.id, number: quoteSeq };
  });
}

export async function updateQuote(db: Db, t: TenantContext, id: string, lockVersion: number, content: QuoteContentInput) {
  return db.$transaction(async (tx) => {
    const q = await loadQuote(tx, t.tenantId, id);
    if (q.status === 'APPROVED') {
      throw conflict('Orçamento aprovado não pode ser alterado. Use "Duplicar" para criar um novo a partir dele.', 'LOCKED');
    }
    if (q.lockVersion !== lockVersion) throw conflict(STALE_MESSAGE, 'STALE');
    await assertCustomer(tx, t.tenantId, content.customerId);

    // Se a revisão atual já foi emitida, a edição abre uma nova revisão (a anterior fica preservada).
    const issued = await tx.quoteVersion.findUnique({
      where: { quoteId_revision: { quoteId: id, revision: q.currentRevision } },
      select: { id: true },
    });
    const revision = issued ? q.currentRevision + 1 : q.currentRevision;
    const before = centsOut(q.totalCents);
    const calc = calculateQuote(content);

    const updated = await tx.quote.updateMany({
      where: { id, tenantId: t.tenantId, lockVersion },
      data: {
        ...contentToQuoteFields(content),
        status: 'DRAFT',
        currentRevision: revision,
        totalCents: BigInt(calc.totals.totalCents),
        lockVersion: { increment: 1 },
      },
    });
    if (updated.count === 0) throw conflict(STALE_MESSAGE, 'STALE');

    await tx.quoteItem.deleteMany({ where: { tenantId: t.tenantId, quoteId: id } });
    await tx.quoteMaterial.deleteMany({ where: { tenantId: t.tenantId, quoteId: id } });
    await tx.quoteCost.deleteMany({ where: { tenantId: t.tenantId, quoteId: id } });
    await writeChildren(tx, t.tenantId, id, content);

    if (revision !== q.currentRevision) {
      await audit(tx, { tenantId: t.tenantId, userId: t.userId, action: 'quote.revision_started', entityType: 'Quote', entityId: id, data: { revision }, ip: t.ip });
    }
    await audit(tx, {
      tenantId: t.tenantId,
      userId: t.userId,
      action: 'quote.updated',
      entityType: 'Quote',
      entityId: id,
      data: { revision, totalBefore: before, totalAfter: calc.totals.totalCents, statusBefore: q.status },
      ip: t.ip,
    });
  });
}

function assertIssuable(q: QuoteFullRow, today: string) {
  const calc = calculateQuote(rowsToContent(q));
  if (calc.items.length === 0) throw badRequest('Adicione pelo menos um serviço antes de emitir o orçamento.');
  if (calc.totals.totalCents <= 0) throw badRequest('O valor total está zerado. Confira preços e desconto.');
  if (dateOut(q.validUntil) < today) {
    throw badRequest('A validade do orçamento já passou. Edite e escolha uma nova data de validade.', {
      validUntil: 'Escolha uma data a partir de hoje.',
    });
  }
  return calc;
}

/** Cria a fotografia imutável da revisão atual (se ainda não existir). */
async function ensureVersion(tx: Tx, t: TenantContext, q: QuoteFullRow) {
  const existing = await tx.quoteVersion.findUnique({
    where: { quoteId_revision: { quoteId: q.id, revision: q.currentRevision } },
  });
  if (existing) return existing;
  const company = await loadCompanyForDoc(tx, t.tenantId);
  const doc = buildQuoteDocument(q, company, { isDraft: false });
  return tx.quoteVersion.create({
    data: {
      tenantId: t.tenantId,
      quoteId: q.id,
      revision: q.currentRevision,
      snapshot: doc as unknown as Prisma.InputJsonValue,
      totalCents: BigInt(doc.calculation.totals.totalCents),
      createdById: t.userId,
    },
  });
}

export async function sendQuote(db: Db, t: TenantContext, id: string) {
  return db.$transaction(async (tx) => {
    const q = await loadQuote(tx, t.tenantId, id);
    if (q.status === 'APPROVED') throw conflict('Este orçamento já foi aprovado.', 'LOCKED');
    const today = todayISO();
    assertIssuable(q, today);
    const version = await ensureVersion(tx, t, q);
    if (q.status !== 'SENT') {
      await tx.quote.update({
        where: { id, tenantId: t.tenantId },
        data: { status: 'SENT', sentAt: new Date(), refusedAt: null, refusedReason: null, lockVersion: { increment: 1 } },
      });
      await audit(tx, {
        tenantId: t.tenantId,
        userId: t.userId,
        action: 'quote.sent',
        entityType: 'Quote',
        entityId: id,
        data: { revision: version.revision, totalCents: centsOut(version.totalCents) },
        ip: t.ip,
      });
    }
    return version.revision;
  });
}

export async function approveQuote(db: Db, t: TenantContext, id: string, input: z.infer<typeof quoteApproveSchema>) {
  return db.$transaction(async (tx) => {
    const q = await loadQuote(tx, t.tenantId, id);
    if (q.status === 'APPROVED') throw conflict('Este orçamento já está aprovado.', 'ALREADY_APPROVED');
    const today = todayISO();
    if (input.approvedOn > today) {
      throw badRequest('A data da aprovação não pode ser no futuro.', { approvedOn: 'Use a data de hoje ou anterior.' });
    }
    const validUntil = dateOut(q.validUntil);
    if (input.approvedOn > validUntil) {
      throw conflict(
        `A aprovação (${formatDateBR(input.approvedOn)}) é posterior à validade (${formatDateBR(validUntil)}). Edite o orçamento, atualize a validade e emita de novo.`,
        'EXPIRED',
      );
    }
    if (q.status === 'DRAFT') assertIssuable(q, input.approvedOn);
    const version = await ensureVersion(tx, t, q);
    await tx.quoteApproval.create({
      data: {
        tenantId: t.tenantId,
        quoteId: id,
        versionId: version.id,
        approvedByName: input.approvedByName,
        channel: input.channel,
        approvedOn: dateIn(input.approvedOn),
        note: input.note,
        recordedById: t.userId,
      },
    });
    await tx.quote.update({
      where: { id, tenantId: t.tenantId },
      data: {
        status: 'APPROVED',
        approvedAt: new Date(),
        sentAt: q.sentAt ?? new Date(),
        lockVersion: { increment: 1 },
      },
    });
    await audit(tx, {
      tenantId: t.tenantId,
      userId: t.userId,
      action: 'quote.approved',
      entityType: 'Quote',
      entityId: id,
      data: {
        revision: version.revision,
        totalCents: centsOut(version.totalCents),
        approvedByName: input.approvedByName,
        channel: input.channel,
        approvedOn: input.approvedOn,
      },
      ip: t.ip,
    });
    return { revision: version.revision };
  });
}

export async function refuseQuote(db: Db, t: TenantContext, id: string, reason: string | null) {
  return db.$transaction(async (tx) => {
    const q = await loadQuote(tx, t.tenantId, id);
    if (q.status !== 'SENT') throw conflict('Só é possível marcar como recusado um orçamento enviado.');
    await tx.quote.update({
      where: { id, tenantId: t.tenantId },
      data: { status: 'REFUSED', refusedAt: new Date(), refusedReason: reason, lockVersion: { increment: 1 } },
    });
    await audit(tx, { tenantId: t.tenantId, userId: t.userId, action: 'quote.refused', entityType: 'Quote', entityId: id, data: { reason }, ip: t.ip });
  });
}

export async function duplicateQuote(db: Db, t: TenantContext, id: string) {
  const q = await loadQuote(db, t.tenantId, id);
  const profile = await db.companyProfile.findUniqueOrThrow({ where: { tenantId: t.tenantId }, select: { defaultValidityDays: true } });
  const content = rowsToContent(q);
  const customerActive = await db.customer.count({ where: { id: q.customerId, tenantId: t.tenantId, deletedAt: null } });
  if (!customerActive) throw badRequest('O cliente deste orçamento foi excluído. Crie um novo orçamento.');
  content.title = `${content.title} (cópia)`.slice(0, 160);
  content.validUntil = addDaysISO(todayISO(), profile.defaultValidityDays);
  return createQuote(db, t, content, { duplicatedFrom: q.number });
}

export async function deleteQuote(db: Db, t: TenantContext, id: string) {
  return db.$transaction(async (tx) => {
    const q = await loadQuote(tx, t.tenantId, id);
    const versions = await tx.quoteVersion.count({ where: { tenantId: t.tenantId, quoteId: id } });
    if (versions > 0 || q.status !== 'DRAFT') {
      throw conflict('Orçamentos já emitidos ficam guardados no histórico e não podem ser excluídos.');
    }
    await tx.quote.update({ where: { id, tenantId: t.tenantId }, data: { deletedAt: new Date() } });
    await audit(tx, { tenantId: t.tenantId, userId: t.userId, action: 'quote.deleted', entityType: 'Quote', entityId: id, data: { number: q.number }, ip: t.ip });
  });
}

const HISTORY_LABELS: Record<string, string> = {
  'quote.created': 'Orçamento criado',
  'quote.updated': 'Orçamento alterado',
  'quote.revision_started': 'Nova revisão iniciada',
  'quote.sent': 'Orçamento emitido / enviado',
  'quote.approved': 'Aprovação registrada',
  'quote.refused': 'Marcado como recusado',
  'quote.share_link_created': 'Link de compartilhamento criado',
  'quote.public_pdf_viewed': 'Cliente abriu o link',
};

export async function getQuoteDetail(db: Db, t: TenantContext, id: string): Promise<QuoteDetailDTO> {
  const q = await loadQuote(db, t.tenantId, id);
  const project = await db.project.findFirst({ where: { tenantId: t.tenantId, quoteId: id }, select: { id: true } });
  const [versions, approval, logs] = await Promise.all([
    db.quoteVersion.findMany({
      where: { tenantId: t.tenantId, quoteId: id },
      orderBy: { revision: 'desc' },
      select: { revision: true, createdAt: true, createdById: true, totalCents: true },
    }),
    db.quoteApproval.findFirst({
      where: { tenantId: t.tenantId, quoteId: id },
      orderBy: { createdAt: 'desc' },
      include: { version: { select: { revision: true } } },
    }),
    db.auditLog.findMany({
      where: { tenantId: t.tenantId, entityType: 'Quote', entityId: id, action: { in: Object.keys(HISTORY_LABELS) } },
      orderBy: { createdAt: 'desc' },
      take: 100,
    }),
  ]);
  const userIds = [
    ...new Set(
      [...versions.map((v) => v.createdById), approval?.recordedById, ...logs.map((l) => l.userId)].filter(
        (x): x is string => !!x,
      ),
    ),
  ];
  // Somente nomes de usuários vinculados a esta empresa.
  const users = await db.user.findMany({
    where: { id: { in: userIds }, memberships: { some: { tenantId: t.tenantId } } },
    select: { id: true, name: true },
  });
  const nameOf = (uid: string | null | undefined) => (uid ? (users.find((u) => u.id === uid)?.name ?? null) : null);

  const content = rowsToContent(q);
  const calc = calculateQuote(content);
  const canSeeCosts = t.permissions.includes('quote:view_costs');
  return {
    ...toQuoteSummary(q),
    lockVersion: q.lockVersion,
    content,
    calculation: canSeeCosts ? calc : null,
    clientTotals: {
      subtotalCents: calc.totals.subtotalCents,
      discountCents: calc.totals.discountCents,
      totalCents: calc.totals.totalCents,
    },
    versions: versions.map((v) => ({
      revision: v.revision,
      createdAt: v.createdAt.toISOString(),
      createdByName: nameOf(v.createdById),
      totalCents: centsOut(v.totalCents),
    })),
    approval: approval
      ? {
          approvedByName: approval.approvedByName,
          channel: approval.channel,
          approvedOn: dateOut(approval.approvedOn),
          note: approval.note,
          revision: approval.version.revision,
          recordedByName: nameOf(approval.recordedById),
          recordedAt: approval.createdAt.toISOString(),
        }
      : null,
    refusedReason: q.refusedReason,
    history: logs.map((l) => ({
      action: l.action,
      label: HISTORY_LABELS[l.action] ?? l.action,
      at: l.createdAt.toISOString(),
      userName: nameOf(l.userId),
    })),
    canEdit: q.status !== 'APPROVED' && t.permissions.includes('quote:write'),
    sentAt: q.sentAt?.toISOString() ?? null,
    projectId: project?.id ?? null,
  };
}

/** Documento para PDF: rascunho ao vivo, ou a fotografia de uma revisão emitida. */
export async function getQuoteDocument(
  db: Db,
  tenantId: string,
  id: string,
  revision?: number,
): Promise<QuoteDocument> {
  const q = await loadQuote(db, tenantId, id);
  if (revision === undefined && q.status === 'DRAFT') {
    const company = await loadCompanyForDoc(db, tenantId);
    return buildQuoteDocument(q, company, { isDraft: true });
  }
  const version = await db.quoteVersion.findFirst({
    where: { tenantId, quoteId: id, ...(revision !== undefined ? { revision } : {}) },
    orderBy: { revision: 'desc' },
  });
  if (!version) throw notFound('Revisão não encontrada.');
  return version.snapshot as unknown as QuoteDocument;
}

export async function loadLogo(db: Db, tenantId: string): Promise<Buffer | null> {
  const p = await db.companyProfile.findUnique({ where: { tenantId }, select: { logo: true } });
  return p?.logo ? Buffer.from(p.logo) : null;
}

export async function createShareLink(
  ctx: AppContext,
  t: TenantContext,
  id: string,
  mode: 'detailed' | 'summary',
): Promise<QuoteShareDTO> {
  const { db } = ctx;
  const q = await loadQuote(db, t.tenantId, id);
  if (q.status === 'DRAFT') throw conflict('Emita o orçamento antes de compartilhar.', 'NOT_ISSUED');
  const version = await db.quoteVersion.findFirst({
    where: { tenantId: t.tenantId, quoteId: id },
    orderBy: { revision: 'desc' },
  });
  if (!version) throw conflict('Emita o orçamento antes de compartilhar.', 'NOT_ISSUED');

  const token = generateToken(24);
  const validUntilEnd = new Date(`${dateOut(q.validUntil)}T23:59:59-03:00`).getTime() + 30 * 86400_000;
  const expiresAt = new Date(Math.max(validUntilEnd, Date.now() + 7 * 86400_000));
  await db.quoteShareLink.create({
    data: {
      tenantId: t.tenantId,
      quoteId: id,
      revision: version.revision,
      mode: mode === 'summary' ? 'SUMMARY' : 'DETAILED',
      tokenHash: sha256(token),
      expiresAt,
      createdById: t.userId,
    },
  });
  await audit(db, {
    tenantId: t.tenantId,
    userId: t.userId,
    action: 'quote.share_link_created',
    entityType: 'Quote',
    entityId: id,
    data: { revision: version.revision, mode },
    ip: t.ip,
  });

  const url = `${ctx.config.publicAppUrl}/api/public/quotes/${token}/pdf`;
  const snapshot = version.snapshot as unknown as QuoteDocument;
  const message = [
    `Olá, ${q.customer.name}!`,
    `Segue o orçamento nº ${quoteNumberLabel(q.number)} - ${q.title}.`,
    `Valor: ${formatBRL(centsOut(version.totalCents))}. Válido até ${formatDateBR(dateOut(q.validUntil))}.`,
    `Veja o PDF: ${url}`,
    snapshot.company.tradeName,
  ].join('\n');
  const phone = whatsappNumber(q.customer.whatsapp ?? q.customer.phone);
  const whatsappUrl = `https://wa.me/${phone ?? ''}?text=${encodeURIComponent(message)}`;
  return { url, expiresAt: expiresAt.toISOString(), whatsappUrl, message };
}
