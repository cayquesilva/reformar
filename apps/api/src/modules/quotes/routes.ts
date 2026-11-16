import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import {
  PDF_MODES,
  quoteApproveSchema,
  quoteContentSchema,
  quoteNumberLabel,
  quoteRefuseSchema,
  quoteShareSchema,
  quoteUpdateSchema,
  todayISO,
  type Paginated,
  type QuoteSummaryDTO,
} from '@reformar/shared';
import type { AppContext } from '../../context.js';
import type { Prisma } from '../../db.js';
import { dateIn } from '../../lib/convert.js';
import { forbidden } from '../../lib/errors.js';
import { withIdempotency } from '../../lib/idempotency.js';
import { requireTenant } from '../../plugins/auth.js';
import { quoteSummarySelect, toQuoteSummary } from './mapper.js';
import { renderQuotePdf } from './pdf.js';
import {
  approveQuote,
  createQuote,
  createShareLink,
  deleteQuote,
  duplicateQuote,
  getQuoteDetail,
  getQuoteDocument,
  loadLogo,
  refuseQuote,
  sendQuote,
  updateQuote,
} from './service.js';

const idParams = z.object({ id: z.uuid() });

const listQuery = z.object({
  status: z.enum(['DRAFT', 'SENT', 'APPROVED', 'REFUSED', 'EXPIRED', 'OPEN']).optional(),
  customerId: z.uuid().optional(),
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(30),
});

const pdfQuery = z.object({
  mode: z.enum(PDF_MODES).default('detailed'),
  revision: z.coerce.number().int().min(1).optional(),
  download: z.enum(['1', '0']).optional(),
});

export async function quoteRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get('/api/quotes', async (request): Promise<Paginated<QuoteSummaryDTO>> => {
    const t = requireTenant(request, 'quote:read');
    const query = listQuery.parse(request.query);
    const today = todayISO();
    const todayDate = dateIn(today);

    const where: Prisma.QuoteWhereInput = { tenantId: t.tenantId, deletedAt: null };
    if (query.customerId) where.customerId = query.customerId;
    switch (query.status) {
      case 'EXPIRED':
        Object.assign(where, { status: 'SENT', validUntil: { lt: todayDate } });
        break;
      case 'SENT':
        Object.assign(where, { status: 'SENT', validUntil: { gte: todayDate } });
        break;
      case 'OPEN':
        where.status = { in: ['DRAFT', 'SENT'] };
        break;
      case undefined:
        break;
      default:
        where.status = query.status;
    }
    if (query.q) {
      const n = Number(query.q.replace(/\D/g, ''));
      where.OR = [
        { title: { contains: query.q, mode: 'insensitive' } },
        { customer: { name: { contains: query.q, mode: 'insensitive' } } },
        ...(Number.isSafeInteger(n) && n > 0 && /^\D*\d+$/.test(query.q) ? [{ number: n }] : []),
      ];
    }
    const [rows, total] = await Promise.all([
      db.quote.findMany({
        where,
        select: quoteSummarySelect,
        orderBy: { updatedAt: 'desc' },
        skip: (query.page - 1) * query.pageSize,
        take: query.pageSize,
      }),
      db.quote.count({ where }),
    ]);
    return { data: rows.map((r) => toQuoteSummary(r, today)), total, page: query.page, pageSize: query.pageSize };
  });

  app.post('/api/quotes', async (request, reply) => {
    const t = requireTenant(request, 'quote:write');
    const content = quoteContentSchema.parse(request.body);
    const result = await withIdempotency(db, request, t, 'quote.create', async () => ({
      status: 201,
      body: await createQuote(db, t, content),
    }));
    return reply.status(result.status).header('Idempotent-Replayed', String(result.replayed)).send(result.body);
  });

  app.get('/api/quotes/:id', async (request) => {
    const t = requireTenant(request, 'quote:read');
    const { id } = idParams.parse(request.params);
    return getQuoteDetail(db, t, id);
  });

  app.put('/api/quotes/:id', async (request) => {
    const t = requireTenant(request, 'quote:write');
    const { id } = idParams.parse(request.params);
    const { lockVersion, content } = quoteUpdateSchema.parse(request.body);
    await updateQuote(db, t, id, lockVersion, content);
    return getQuoteDetail(db, t, id);
  });

  app.delete('/api/quotes/:id', async (request) => {
    const t = requireTenant(request, 'quote:write');
    const { id } = idParams.parse(request.params);
    await deleteQuote(db, t, id);
    return { ok: true };
  });

  app.post('/api/quotes/:id/send', async (request) => {
    const t = requireTenant(request, 'quote:send');
    const { id } = idParams.parse(request.params);
    await sendQuote(db, t, id);
    return getQuoteDetail(db, t, id);
  });

  app.post('/api/quotes/:id/approve', async (request, reply) => {
    const t = requireTenant(request, 'quote:approve');
    const { id } = idParams.parse(request.params);
    const input = quoteApproveSchema.parse(request.body);
    const result = await withIdempotency(db, request, t, `quote.approve:${id}`, async () => ({
      status: 200,
      body: await approveQuote(db, t, id, input),
    }));
    return reply.status(result.status).send(await getQuoteDetail(db, t, id));
  });

  app.post('/api/quotes/:id/refuse', async (request) => {
    const t = requireTenant(request, 'quote:approve');
    const { id } = idParams.parse(request.params);
    const { reason } = quoteRefuseSchema.parse(request.body ?? {});
    await refuseQuote(db, t, id, reason);
    return getQuoteDetail(db, t, id);
  });

  app.post('/api/quotes/:id/duplicate', async (request, reply) => {
    const t = requireTenant(request, 'quote:write');
    const { id } = idParams.parse(request.params);
    const result = await withIdempotency(db, request, t, `quote.duplicate:${id}`, async () => ({
      status: 201,
      body: await duplicateQuote(db, t, id),
    }));
    return reply.status(result.status).send(result.body);
  });

  app.post('/api/quotes/:id/share', async (request) => {
    const t = requireTenant(request, 'quote:send');
    const { id } = idParams.parse(request.params);
    const { mode } = quoteShareSchema.parse(request.body ?? {});
    return createShareLink(ctx, t, id, mode);
  });

  app.get('/api/quotes/:id/pdf', async (request, reply) => {
    const t = requireTenant(request, 'quote:read');
    const { id } = idParams.parse(request.params);
    const { mode, revision, download } = pdfQuery.parse(request.query);
    if (mode === 'internal' && !t.permissions.includes('quote:view_costs')) {
      throw forbidden('Você não tem permissão para ver custos internos.');
    }
    const document = await getQuoteDocument(db, t.tenantId, id, revision);
    const pdf = await renderQuotePdf(document, mode, await loadLogo(db, t.tenantId));
    const suffix = mode === 'internal' ? '-INTERNO' : mode === 'summary' ? '-resumido' : '';
    const filename = `orcamento-${quoteNumberLabel(document.number)}-r${document.revision}${suffix}.pdf`;
    return reply
      .header('Content-Type', 'application/pdf')
      .header('Content-Disposition', `${download === '1' ? 'attachment' : 'inline'}; filename="${filename}"`)
      .header('Cache-Control', 'private, no-store')
      .send(pdf);
  });
}
