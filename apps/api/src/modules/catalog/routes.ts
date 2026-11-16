import type { FastifyInstance } from 'fastify';
import { z } from 'zod';
import { serviceCatalogSchema, type ServiceDTO } from '@reformar/shared';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { centsIn, centsOut } from '../../lib/convert.js';
import { conflict, notFound } from '../../lib/errors.js';
import { requireTenant } from '../../plugins/auth.js';
import { Prisma } from '../../db.js';

type ServiceRow = NonNullable<Awaited<ReturnType<AppContext['db']['serviceCatalogItem']['findFirst']>>>;

function toDTO(s: ServiceRow): ServiceDTO {
  return {
    id: s.id,
    name: s.name,
    description: s.description,
    unit: s.unit,
    defaultPriceCents: centsOut(s.defaultPriceCents),
    active: s.active,
  };
}

function isUniqueViolation(e: unknown): boolean {
  return e instanceof Prisma.PrismaClientKnownRequestError && e.code === 'P2002';
}

const DUPLICATE = 'Já existe um serviço com esse nome.';

export async function catalogRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get('/api/services', async (request): Promise<ServiceDTO[]> => {
    const t = requireTenant(request, 'catalog:read');
    const { all } = z.object({ all: z.enum(['true', 'false']).optional() }).parse(request.query);
    const rows = await db.serviceCatalogItem.findMany({
      where: { tenantId: t.tenantId, ...(all === 'true' ? {} : { active: true }) },
      orderBy: { name: 'asc' },
    });
    return rows.map(toDTO);
  });

  app.post('/api/services', async (request, reply) => {
    const t = requireTenant(request, 'catalog:write');
    const input = serviceCatalogSchema.parse(request.body);
    try {
      const s = await db.serviceCatalogItem.create({
        data: { ...input, defaultPriceCents: centsIn(input.defaultPriceCents), tenantId: t.tenantId },
      });
      await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'service.created', entityType: 'ServiceCatalogItem', entityId: s.id, ip: t.ip });
      return reply.status(201).send(toDTO(s));
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict(DUPLICATE);
      throw e;
    }
  });

  app.put('/api/services/:id', async (request): Promise<ServiceDTO> => {
    const t = requireTenant(request, 'catalog:write');
    const { id } = z.object({ id: z.uuid() }).parse(request.params);
    const input = serviceCatalogSchema.parse(request.body);
    const existing = await db.serviceCatalogItem.findFirst({ where: { id, tenantId: t.tenantId } });
    if (!existing) throw notFound('Serviço não encontrado.');
    try {
      const s = await db.serviceCatalogItem.update({
        where: { id, tenantId: t.tenantId },
        data: { ...input, defaultPriceCents: centsIn(input.defaultPriceCents) },
      });
      await audit(db, {
        tenantId: t.tenantId,
        userId: t.userId,
        action: 'service.updated',
        entityType: 'ServiceCatalogItem',
        entityId: id,
        data: { before: centsOut(existing.defaultPriceCents), after: input.defaultPriceCents },
        ip: t.ip,
      });
      return toDTO(s);
    } catch (e) {
      if (isUniqueViolation(e)) throw conflict(DUPLICATE);
      throw e;
    }
  });
}
