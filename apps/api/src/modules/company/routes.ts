import type { FastifyInstance } from 'fastify';
import { companyProfileSchema, type CompanyProfileDTO } from '@reformar/shared';
import type { AppContext } from '../../context.js';
import { audit } from '../../lib/audit.js';
import { badRequest, notFound } from '../../lib/errors.js';
import { requireTenant } from '../../plugins/auth.js';

export const MAX_LOGO_BYTES = 512 * 1024;

/** Confere a assinatura binária (magic bytes): não confia no Content-Type enviado. */
export function detectImageMime(buf: Buffer): 'image/png' | 'image/jpeg' | null {
  if (buf.length > 8 && buf.subarray(0, 8).equals(Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]))) {
    return 'image/png';
  }
  if (buf.length > 3 && buf[0] === 0xff && buf[1] === 0xd8 && buf[2] === 0xff) return 'image/jpeg';
  return null;
}

type ProfileRow = Awaited<ReturnType<AppContext['db']['companyProfile']['findUnique']>>;

export function profileToDTO(p: NonNullable<ProfileRow>): CompanyProfileDTO {
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
    defaultValidityDays: p.defaultValidityDays,
    defaultPaymentTerms: p.defaultPaymentTerms,
    defaultExclusions: p.defaultExclusions,
    defaultNotes: p.defaultNotes,
    hasLogo: p.logo !== null,
    updatedAt: p.updatedAt.toISOString(),
  };
}

export async function companyRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;

  app.get('/api/company', async (request): Promise<CompanyProfileDTO> => {
    const t = requireTenant(request, 'company:read');
    const profile = await db.companyProfile.findUnique({ where: { tenantId: t.tenantId } });
    if (!profile) throw notFound('Perfil da empresa não encontrado.');
    return profileToDTO(profile);
  });

  app.put('/api/company', async (request): Promise<CompanyProfileDTO> => {
    const t = requireTenant(request, 'company:manage');
    const input = companyProfileSchema.parse(request.body);
    const profile = await db.$transaction(async (tx) => {
      const p = await tx.companyProfile.update({ where: { tenantId: t.tenantId }, data: input });
      await tx.tenant.update({ where: { id: t.tenantId }, data: { name: input.tradeName } });
      await audit(tx, {
        tenantId: t.tenantId,
        userId: t.userId,
        action: 'company.updated',
        entityType: 'CompanyProfile',
        entityId: t.tenantId,
        ip: t.ip,
      });
      return p;
    });
    return profileToDTO(profile);
  });

  app.put('/api/company/logo', { bodyLimit: MAX_LOGO_BYTES }, async (request) => {
    const t = requireTenant(request, 'company:manage');
    const body = request.body;
    if (!Buffer.isBuffer(body) || body.length === 0) {
      throw badRequest('Envie uma imagem PNG ou JPEG de até 512 KB.');
    }
    const mime = detectImageMime(body);
    if (!mime) throw badRequest('Formato não aceito. Use uma imagem PNG ou JPEG.');
    await db.companyProfile.update({ where: { tenantId: t.tenantId }, data: { logo: new Uint8Array(body), logoMime: mime } });
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'company.logo_updated', entityType: 'CompanyProfile', entityId: t.tenantId, data: { bytes: body.length, mime }, ip: t.ip });
    return { ok: true };
  });

  app.delete('/api/company/logo', async (request) => {
    const t = requireTenant(request, 'company:manage');
    await db.companyProfile.update({ where: { tenantId: t.tenantId }, data: { logo: null, logoMime: null } });
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'company.logo_removed', entityType: 'CompanyProfile', entityId: t.tenantId, ip: t.ip });
    return { ok: true };
  });

  app.get('/api/company/logo', async (request, reply) => {
    const t = requireTenant(request, 'company:read');
    const p = await db.companyProfile.findUnique({
      where: { tenantId: t.tenantId },
      select: { logo: true, logoMime: true },
    });
    if (!p?.logo || !p.logoMime) throw notFound('Sem logomarca.');
    return reply
      .header('Content-Type', p.logoMime)
      .header('Cache-Control', 'private, max-age=60')
      .header('Content-Disposition', 'inline')
      .send(Buffer.from(p.logo));
  });
}

/**
 * Exportação completa dos dados da empresa (portabilidade/LGPD). Sempre disponível,
 * inclusive com a assinatura inativa. Não inclui senhas, tokens nem dados de outras empresas.
 */
export async function companyExportRoutes(app: FastifyInstance, ctx: AppContext) {
  const { db } = ctx;
  app.get('/api/company/export', async (request, reply) => {
    const t = requireTenant(request, 'company:manage');
    const where = { tenantId: t.tenantId };
    const json = (v: unknown) =>
      JSON.stringify(v, (_k, value) => (typeof value === 'bigint' ? Number(value) : value instanceof Uint8Array ? undefined : value), 2);
    const data = {
      exportedAt: new Date().toISOString(),
      note: 'Valores monetários em centavos. Datas em ISO 8601.',
      company: await db.companyProfile.findUnique({ where, omit: { logo: true } }),
      members: await db.membership.findMany({ where, select: { role: true, active: true, createdAt: true, user: { select: { name: true, email: true } } } }),
      customers: await db.customer.findMany({ where }),
      services: await db.serviceCatalogItem.findMany({ where }),
      quotes: await db.quote.findMany({ where, include: { items: true, materials: true, costs: true, approvals: true } }),
      quoteVersions: await db.quoteVersion.findMany({ where }),
      projects: await db.project.findMany({ where, include: { stages: true, materials: true } }),
      measurements: await db.measurement.findMany({ where, include: { items: true } }),
      diary: await db.diaryEntry.findMany({ where }),
      attachments: await db.attachment.findMany({ where: { ...where, deletedAt: null }, omit: { storageKey: true } }),
      expenses: await db.expense.findMany({ where }),
      receivables: await db.receivable.findMany({ where, include: { payments: true } }),
      materials: await db.material.findMany({ where }),
      stockLocations: await db.stockLocation.findMany({ where }),
      stockMovements: await db.stockMovement.findMany({ where }),
      auditLog: await db.auditLog.findMany({ where, orderBy: { createdAt: 'asc' } }),
    };
    await audit(db, { tenantId: t.tenantId, userId: t.userId, action: 'company.exported', entityType: 'Tenant', entityId: t.tenantId, ip: t.ip });
    return reply
      .header('Content-Type', 'application/json; charset=utf-8')
      .header('Content-Disposition', 'attachment; filename="reformar-exportacao.json"')
      .header('Cache-Control', 'private, no-store')
      .send(json(data));
  });
}
