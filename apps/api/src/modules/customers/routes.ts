import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { customerSchema, type CustomerDetailDTO, type CustomerDTO, type Paginated } from '@reformar/shared';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { notFound } from '../../lib/errors.js';
import { requireTenant } from '../../plugins/auth.js';
import { quoteSummarySelect, toQuoteSummary } from '../quotes/mapper.js';

type CustomerRow = NonNullable<Awaited<ReturnType<AppContext['db']['customer']['findFirst']>>>;

export function customerToDTO(c: CustomerRow): CustomerDTO {
  return {
    id: c.id,
    type: c.type,
    name: c.name,
    document: c.document,
    phone: c.phone,
    whatsapp: c.whatsapp,
    email: c.email,
    addressLine: c.addressLine,
    city: c.city,
    state: c.state,
    zipCode: c.zipCode,
    notes: c.notes,
    createdAt: c.createdAt.toISOString(),
    updatedAt: c.updatedAt.toISOString(),
  };
}

const idParams = z.object({ id: z.uuid() });
const listQuery = z.object({
  q: z.string().trim().max(100).optional(),
  page: z.coerce.number().int().min(1).default(1),
  pageSize: z.coerce.number().int().min(1).max(100).default(50),
});

export async function customerRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get('/api/customers', async (request): Promise<Paginated<CustomerDTO>> => {
    const t = requireTenant(request, 'customer:read');
    const { q, page, pageSize } = listQuery.parse(request.query);
    const digits = q?.replace(/\D/g, '');
    const where = {
      tenantId: t.tenantId,
      deletedAt: null,
      ...(q
        ? {
            OR: [
              { name: { contains: q, mode: 'insensitive' as const } },
              ...(digits && digits.length >= 3
                ? [{ phone: { contains: digits } }, { whatsapp: { contains: digits } }, { document: { contains: digits } }]
                : []),
            ],
          }
        : {}),
    };
    const [rows, total] = await Promise.all([
      db.customer.findMany({ where, orderBy: { name: 'asc' }, skip: (page - 1) * pageSize, take: pageSize }),
      db.customer.count({ where }),
    ]);
    return { data: rows.map(customerToDTO), total, page, pageSize };
  });

  app.post('/api/customers', async (request, reply) => {
    const t = requireTenant(request, 'customer:write');
    const input = customerSchema.parse(request.body);
    const customer = await db.$transaction(async (tx) => {
      const c = await tx.customer.create({ data: { ...input, tenantId: t.tenantId } });
      await audit(tx, { tenantId: t.tenantId, userId: t.userId, action: 'customer.created', entityType: 'Customer', entityId: c.id, ip: t.ip });
      return c;
    });
    return reply.status(201).send(customerToDTO(customer));
  });

  app.get('/api/customers/:id', async (request): Promise<CustomerDetailDTO> => {
    const t = requireTenant(request, 'customer:read');
    const { id } = idParams.parse(request.params);
    const customer = await db.customer.findFirst({ where: { id, tenantId: t.tenantId, deletedAt: null } });
    if (!customer) throw notFound('Cliente não encontrado.');
    const quotes = t.permissions.includes('quote:read')
      ? await db.quote.findMany({
          where: { tenantId: t.tenantId, customerId: id, deletedAt: null },
          orderBy: { createdAt: 'desc' },
          take: 50,
          select: quoteSummarySelect,
        })
      : [];
    return { ...customerToDTO(customer), quotes: quotes.map((q) => toQuoteSummary(q)) };
  });

  app.put('/api/customers/:id', async (request): Promise<CustomerDTO> => {
    const t = requireTenant(request, 'customer:write');
    const { id } = idParams.parse(request.params);
    const input = customerSchema.parse(request.body);
    const customer = await db.$transaction(async (tx) => {
      const existing = await tx.customer.findFirst({ where: { id, tenantId: t.tenantId, deletedAt: null } });
      if (!existing) throw notFound('Cliente não encontrado.');
      const c = await tx.customer.update({ where: { id, tenantId: t.tenantId }, data: input });
      await audit(tx, { tenantId: t.tenantId, userId: t.userId, action: 'customer.updated', entityType: 'Customer', entityId: id, ip: t.ip });
      return c;
    });
    return customerToDTO(customer);
  });

  // Exclusão lógica: preserva histórico dos orçamentos já emitidos.
  app.delete('/api/customers/:id', async (request) => {
    const t = requireTenant(request, 'customer:write');
    const { id } = idParams.parse(request.params);
    const result = await db.customer.updateMany({
      where: { id, tenantId: t.tenantId, deletedAt: null },
      data: { deletedAt: new Date() },
    });
    if (result.count === 0) throw notFound('Cliente não encontrado.');
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'customer.deleted', entityType: 'Customer', entityId: id, ip: t.ip });
    return { ok: true };
  });
}
